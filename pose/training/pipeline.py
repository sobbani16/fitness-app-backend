"""HUM-100 §19 — reproducible training pipeline scaffolding.

Reproducibility contract: identical (config, datasetVersion, seed) must yield
bit-identical checkpoints. Everything stochastic flows through the seeded RNG;
the config hash + seed + dataset version are stamped into every checkpoint
manifest, and the export step produces the exact payload modelRegistry
registration expects.

Runs without real data: --synthetic generates deterministic synthetic angle
sequences (tests-only licensing class), letting the full pipeline smoke-test
end to end. Real footage plugs in via load_dataset() without other changes.
"""
import argparse, hashlib, json, math, os, random, sys

def config_hash(cfg):
    canonical = json.dumps(cfg, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()

def load_dataset(cfg, synthetic=False):
    """Returns (sequences, labels). Real data: consent-gated clips whose
    manifest passes the licensing registry + annotation schema. Synthetic:
    deterministic sinusoidal joint-angle cycles — tests-only per licensing."""
    if synthetic:
        rng = random.Random(cfg["seed"])
        window = cfg["hyperparameters"]["windowFrames"]
        seqs, labels = [], []
        reps = 40
        for i in range(reps):
            freq = 0.2 + rng.random() * 0.1
            phase = rng.random() * math.pi
            seq = [math.sin(phase + f * freq) for f in range(window)]
            seqs.append(seq)
            labels.append(1 if sum(seq) / len(seq) > 0 else 0)  # mean-correlated — the baseline can actually learn it
        return seqs, labels
    raise NotImplementedError("real dataset loading requires licensed footage — needs_human decision #97")

def train(cfg, seqs, labels):
    """Deterministic-baseline trainer: a threshold classifier on mean angle
    velocity. ML architectures plug in behind the same interface. Everything
    derived from seeded state — no wallclock, no dict-order dependence."""
    rng = random.Random(cfg["seed"])
    epochs = cfg["hyperparameters"]["epochs"]
    lr = cfg["hyperparameters"]["learningRate"]
    threshold = rng.uniform(-0.1, 0.1)
    features = [sum(s) / len(s) for s in seqs]
    for _ in range(epochs):
        for x, y in zip(features, labels):
            pred = 1 if x > threshold else 0
            threshold += lr * (y - pred) * 0.01
    correct = sum(1 for x, y in zip(features, labels) if (1 if x > threshold else 0) == y)
    return {
        "architecture": cfg["architecture"],
        "params": {"threshold": round(threshold, 8)},
        "trainMetrics": {"accuracy": round(correct / len(labels), 6), "n": len(labels)},
    }

def checkpoint_manifest(cfg, model):
    blob = json.dumps(model, sort_keys=True).encode()
    return {
        "configHash": config_hash(cfg),
        "seed": cfg["seed"],
        "datasetVersion": cfg["datasetVersion"],
        "exerciseId": cfg["exerciseId"],
        "architecture": cfg["architecture"],
        "checksumSha256": hashlib.sha256(blob).hexdigest(),
        "model": model,
    }

def export_for_registry(manifest, cfg):
    """The exact payload MlModel registration expects (§20)."""
    return {
        "exerciseId": manifest["exerciseId"],
        "architecture": manifest["architecture"],
        "datasetVersion": manifest["datasetVersion"],
        "configHash": manifest["configHash"],
        "seed": manifest["seed"],
        "checksumSha256": manifest["checksumSha256"],
        "evalResults": manifest["model"]["trainMetrics"],
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--synthetic", action="store_true")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    cfg = json.load(open(args.config))
    seqs, labels = load_dataset(cfg, synthetic=args.synthetic)
    model = train(cfg, seqs, labels)
    manifest = checkpoint_manifest(cfg, model)
    out = args.out or f"checkpoint-{manifest['configHash'][:12]}.json"
    with open(out, "w") as f:
        json.dump({"manifest": manifest, "registryPayload": export_for_registry(manifest, cfg)}, f, indent=2)
    print(f"checkpoint written: {out} acc={model['trainMetrics']['accuracy']} sha={manifest['checksumSha256'][:16]}")

if __name__ == "__main__":
    main()
