"""HUM-100 P5 — landmark-to-feature extraction.

Consumes BlazePose-33 landmark frames (x, y, z, visibility per landmark) and
emits the joint-angle time series each exercise definition tracks — the
feature contract between annotation data and the training pipeline. Angle
definitions come from pose/exercises/definitions.json, never hardcoded here,
so a definition update automatically reflows through features.

Frames with low-visibility landmarks are marked uncertain rather than
fabricating angles — pose occlusion is a normal training-data condition.
"""
import json, math, os

DEFS_PATH = os.path.join(os.path.dirname(__file__), "..", "exercises", "definitions.json")

def load_exercise(exercise_id):
    defs = json.load(open(DEFS_PATH))
    for ex in defs["exercises"]:
        if ex["id"] == exercise_id:
            return ex
    raise KeyError(f"unknown exercise: {exercise_id}")

def angle_degrees(a, b, c):
    """Angle at vertex b formed by points a-b-c, in degrees [0, 180]."""
    bax, bay = a["x"] - b["x"], a["y"] - b["y"]
    bcx, bcy = c["x"] - b["x"], c["y"] - b["y"]
    dot = bax * bcx + bay * bcy
    mag = math.hypot(bax, bay) * math.hypot(bcx, bcy)
    if mag == 0:
        return None
    cos = max(-1.0, min(1.0, dot / mag))
    return math.degrees(math.acos(cos))

def resolve_landmark(frame, name):
    """left/right-agnostic resolution: averaged when both sides visible,
    single-side fallback, None when invisible."""
    keys = []
    if name in frame:
        keys = [name]
    else:
        for side in ("left_", "right_"):
            if side + name in frame:
                keys.append(side + name)
    pts = [frame[k] for k in keys if frame[k].get("visibility", 1.0) >= 0.5]
    if not pts:
        return None
    return {
        "x": sum(p["x"] for p in pts) / len(pts),
        "y": sum(p["y"] for p in pts) / len(pts),
        "visibility": min(p.get("visibility", 1.0) for p in pts),
    }

def extract_frame_angles(frame, exercise):
    """One frame → {joint: {'angle': deg|None, 'uncertain': bool}} per tracked angle."""
    out = {}
    for spec in exercise["trackedAngles"]:
        a_name, b_name, c_name = spec["landmarks"]
        a, b, c = (resolve_landmark(frame, a_name), resolve_landmark(frame, b_name), resolve_landmark(frame, c_name))
        if a is None or b is None or c is None:
            out[spec["joint"]] = {"angle": None, "uncertain": True}
            continue
        vis = min(a.get("visibility", 1.0), b.get("visibility", 1.0), c.get("visibility", 1.0))
        out[spec["joint"]] = {"angle": angle_degrees(a, b, c), "uncertain": vis < 0.7}
    return out

def extract_sequence(frames, exercise_id):
    """Landmark frames → per-joint angle series. Uncertain frames keep their
    position (phase timing depends on frame alignment) but are flagged."""
    ex = load_exercise(exercise_id)
    series = {spec["joint"]: [] for spec in ex["trackedAngles"]}
    for frame in frames:
        angles = extract_frame_angles(frame, ex)
        for joint, val in angles.items():
            series[joint].append(val)
    return {"exerciseId": exercise_id, "joints": series, "frameCount": len(frames)}
