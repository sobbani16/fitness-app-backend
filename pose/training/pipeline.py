"""HUM-100 §19 — reproducible training pipeline scaffolding.

Reproducibility contract: identical (config, datasetVersion, seed) must yield
bit-identical checkpoints. Everything stochastic flows through the seeded RNG;
the config hash + seed + dataset version are stamped into every checkpoint
manifest.

Evaluation contract (§18/§20):
  - synthetic fixtures carry stable participant + session ids, and groups are
    split BEFORE fitting — never per-sample, so correlated sequences from the
    same participant/session cannot leak across the partition boundary
  - participant OR session overlap between train and held-out is rejected
    explicitly — leakage is a hard error, not a warning
  - fitting reads the training partition only; held-out metrics are reported
    separately with sample counts
  - synthetic results are SMOKE EVIDENCE ONLY (spec §18: synthetic samples are
    never a substitute for independent real-world validation) — checkpoints
    export locally but carry no registry-ready payload
"""
import argparse, hashlib, json, math, random

def config_hash(cfg):
    canonical = json.dumps(cfg, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()

def load_dataset(cfg, synthetic=False):
    """Returns samples [{participantId, sessionId, seq, label}]. Real data:
    consent-gated clips whose manifest passes licensing + annotation schema.
    Synthetic: deterministic sinusoidal joint-angle cycles — tests-only per
    licensing, with stable participant/session ids so the split contract is
    exercised exactly as real data will be."""
    if synthetic:
        rng = random.Random(cfg["seed"])
        window = cfg["hyperparameters"]["windowFrames"]
        samples = []
        participants = 8
        sessions_per_participant = 2
        reps_per_session = 3
        for p in range(participants):
            for s in range(sessions_per_participant):
                for r in range(reps_per_session):
                    freq = 0.2 + rng.random() * 0.1
                    phase = rng.random() * math.pi
                    seq = [math.sin(phase + f * freq) for f in range(window)]
                    samples.append({
                        "participantId": f"syn_p{p:02d}",
                        "sessionId": f"syn_p{p:02d}_s{s:02d}",
                        "seq": seq,
                        "label": 1 if sum(seq) / len(seq) > 0 else 0,
                    })
        return samples
    raise NotImplementedError("real dataset loading requires licensed footage — needs_human decision #97")

def split_by_participant(samples, seed, heldout_fraction=0.25):
    """Assign whole participant groups to train/held-out deterministically.
    Both partitions are guaranteed nonempty or the run is rejected — a split
    that silently produces an empty held-out set would fabricate evaluation."""
    participants = sorted({s["participantId"] for s in samples})
    if len(participants) < 2:
        raise ValueError("split requires at least 2 participants — cannot form disjoint partitions")
    rng = random.Random(seed)
    shuffled = participants[:]
    rng.shuffle(shuffled)
    n_held = max(1, round(len(shuffled) * heldout_fraction))
    if n_held >= len(shuffled):
        n_held = len(shuffled) - 1
    held_ids = set(shuffled[:n_held])
    train = [s for s in samples if s["participantId"] not in held_ids]
    test = [s for s in samples if s["participantId"] in held_ids]
    if not train or not test:
        raise ValueError("split produced an empty partition — evaluation would be meaningless")
    return train, test

def validate_disjoint(train, test):
    """Hard-reject participant OR session overlap — correlated leakage across
    the boundary inflates held-out metrics and is exactly what §18 forbids."""
    train_p = {s["participantId"] for s in train}
    test_p = {s["participantId"] for s in test}
    overlap_p = train_p & test_p
    if overlap_p:
        raise ValueError(f"participant overlap across split: {sorted(overlap_p)}")
    train_s = {s["sessionId"] for s in train}
    test_s = {s["sessionId"] for s in test}
    overlap_s = train_s & test_s
    if overlap_s:
        raise ValueError(f"session overlap across split: {sorted(overlap_s)}")
    return True

def train_model(cfg, train_samples):
    """Deterministic-baseline trainer: threshold classifier on mean angle.
    Fits on the TRAINING partition only. Everything derived from seeded state —
    no wallclock, no dict-order dependence."""
    rng = random.Random(cfg["seed"])
    epochs = cfg["hyperparameters"]["epochs"]
    lr = cfg["hyperparameters"]["learningRate"]
    threshold = rng.uniform(-0.1, 0.1)
    features = [(sum(s["seq"]) / len(s["seq"]), s["label"]) for s in train_samples]
    for _ in range(epochs):
        for x, y in features:
            pred = 1 if x > threshold else 0
            threshold += lr * (y - pred) * 0.01
    return {"architecture": cfg["architecture"], "params": {"threshold": round(threshold, 8)}}

def _predict(model, s):
    """Prediction + confidence proxy: normalized distance from the decision
    threshold. Real architectures emit calibrated probabilities — the metric
    shapes below are the contract they must fill."""
    threshold = model["params"]["threshold"]
    x = sum(s["seq"]) / len(s["seq"])
    pred = 1 if x > threshold else 0
    conf = min(1.0, abs(x - threshold) * 4)
    return pred, conf

def evaluate(model, samples, abstain_below=0.25):
    """§20 recognition metrics: accuracy, per-class precision/recall/F1, macro
    F1, confusion matrix — plus confidence-derived abstention rate and
    unknown-rejection rate (the fraction of low-confidence inputs the system
    refuses to label). Everything deterministic — no wallclock, no randomness."""
    if not samples:
        return {"accuracy": None, "n": 0}
    labels = sorted({s["label"] for s in samples})
    confusion = {str(a): {str(b): 0 for b in labels} for a in labels}
    correct = 0
    abstained = 0
    rejected_correctly = 0
    low_conf_total = 0
    per_class = {}
    for s in samples:
        pred, conf = _predict(model, s)
        confusion[str(s["label"])][str(pred)] += 1
        if pred == s["label"]:
            correct += 1
        if conf < abstain_below:
            abstained += 1
            low_conf_total += 1
            if pred != s["label"]:
                rejected_correctly += 1
    n = len(samples)
    f1s = []
    for c in labels:
        tp = confusion[str(c)][str(c)]
        fp = sum(confusion[str(o)][str(c)] for o in labels if o != c)
        fn = sum(confusion[str(c)][str(o)] for o in labels if o != c)
        prec = tp / (tp + fp) if (tp + fp) else 0.0
        rec = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
        f1s.append(f1)
        per_class[str(c)] = {"precision": round(prec, 6), "recall": round(rec, 6), "f1": round(f1, 6), "support": sum(confusion[str(c)].values())}
    return {
        "accuracy": round(correct / n, 6),
        "n": n,
        "macroF1": round(sum(f1s) / len(f1s), 6) if f1s else None,
        "perClass": per_class,
        "confusionMatrix": confusion,
        "abstentionRate": round(abstained / n, 6),
        "unknownRejection": {
            "threshold": abstain_below,
            "lowConfidenceFraction": round(low_conf_total / n, 6),
            "note": "confidence is a distance proxy in the deterministic baseline — real architectures emit calibrated probabilities",
        },
    }

def checkpoint_manifest(cfg, model, train_eval, heldout_eval):
    blob = json.dumps(model, sort_keys=True).encode()
    return {
        "configHash": config_hash(cfg),
        "seed": cfg["seed"],
        "datasetVersion": cfg["datasetVersion"],
        "exerciseId": cfg["exerciseId"],
        "architecture": cfg["architecture"],
        "checksumSha256": hashlib.sha256(blob).hexdigest(),
        "model": model,
        "evaluation": {
            "train": train_eval,
            "heldout": heldout_eval,
            "evidenceClass": "synthetic_smoke",
            "smokeEvidenceOnly": True,
            "realWorldValidationRequired": True,
            "note": "Synthetic smoke evidence per spec §18 — never a substitute for independent real-world validation. Not eligible for registry registration or rollout.",
        },
    }

def export_local(manifest, cfg):
    """Synthetic runs export as LOCAL checkpoints only. No registry-ready
    payload is produced — smoke evidence must not enter the §20/§32 registry
    pipeline even by accident."""
    return {
        "eligible": False,
        "reason": "synthetic smoke evidence — not registry-ready (spec §18: synthetic never substitutes real-world validation)",
        "wouldRequire": ["real consented footage (needs_human #97)", "independent real-world evaluation", "baseline comparison on real data"],
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--synthetic", action="store_true")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    cfg = json.load(open(args.config))
    samples = load_dataset(cfg, synthetic=args.synthetic)
    train_samples, test_samples = split_by_participant(samples, cfg["seed"])
    validate_disjoint(train_samples, test_samples)
    model = train_model(cfg, train_samples)
    train_eval = evaluate(model, train_samples)
    heldout_eval = evaluate(model, test_samples)
    manifest = checkpoint_manifest(cfg, model, train_eval, heldout_eval)
    out = args.out or f"checkpoint-{manifest['configHash'][:12]}.json"
    # Serialize ONCE and write those exact bytes — the artifact digest must
    # cover the byte stream as written, not a re-serialization. The digest is
    # emitted on stdout as the export record (it cannot live inside the file
    # it covers); verify_checkpoint.py re-computes it independently.
    blob = json.dumps({"manifest": manifest, "export": export_local(manifest, cfg)}, indent=2).encode()
    with open(out, "wb") as f:
        f.write(blob)
    artifact_sha = hashlib.sha256(blob).hexdigest()
    print(f"checkpoint written: {out} heldout_acc={heldout_eval['accuracy']} n_train={train_eval['n']} n_heldout={heldout_eval['n']} sha={manifest['checksumSha256'][:16]}")
    print(f"artifact_sha256={artifact_sha}")

if __name__ == "__main__":
    main()
