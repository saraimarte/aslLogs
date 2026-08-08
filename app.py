from flask import Flask, request, jsonify, render_template
import json
import os
import tempfile
import threading
import shutil
import time

app = Flask(__name__)
DATA_FILE = 'asl_database.json'

# Guards every read-modify-write cycle so two overlapping requests (e.g. a note
# autosave and a sign save firing close together) can never interleave their
# writes to the JSON file. Without this, one request's half-finished write could
# get mixed with another's, which is what was producing corrupted entries,
# missing commas, unquoted/truncated links, and stray trailing braces.
_db_lock = threading.Lock()


def default_db():
    return {
        "days": {},
        "tools": [
            {"name": "Gemini Live", "link": "https://gemini.google.com/"},
            {"name": "Lifeprint", "link": "https://www.lifeprint.com/"}
        ],
        "signs": {},
        "curriculum_progress": {},
        "review": {}
    }


def load_data():
    if not os.path.exists(DATA_FILE):
        return default_db()

    with open(DATA_FILE, 'r', encoding='utf-8') as f:
        raw = f.read()

    try:
        db = json.loads(raw)
    except json.JSONDecodeError as e:
        # The file on disk is corrupted (from before this fix, or some other
        # interruption). We deliberately do NOT silently reset to a blank
        # database here — that would quietly wipe out real data. Instead, back
        # up the broken file and fail loudly so it's obvious something needs
        # manual attention, with the backup path to send along for a fix.
        backup_path = f"{DATA_FILE}.corrupt-{int(time.time())}.bak"
        try:
            shutil.copy(DATA_FILE, backup_path)
        except OSError:
            backup_path = None
        raise RuntimeError(
            f"{DATA_FILE} is corrupted and could not be parsed ({e}). "
            f"A copy has been saved to '{backup_path}' — send that file over to "
            f"recover the data rather than deleting it."
        ) from e

    if "tools" not in db:
        db["tools"] = []
    if "days" not in db:
        db["days"] = {}
    if "curriculum_progress" not in db:
        db["curriculum_progress"] = {}
    if "review" not in db:
        db["review"] = {}

    # Data Migration: Convert old array of signs to dictionary structure
    if "signs" not in db:
        db["signs"] = {}
    elif isinstance(db["signs"], list):
        new_signs = {}
        for s in db["signs"]:
            new_signs[s] = {"video": "", "notes": ""}
        db["signs"] = new_signs

    return db


def save_data(data):
    """Write atomically: write to a temp file in the same directory, then
    os.replace() it over the real file. os.replace is atomic on POSIX and
    Windows, so a request that reads the file while another is saving will
    always see either the fully-old or fully-new content, never a
    half-written mix (which is what causes broken commas/braces/unfinished
    entries)."""
    directory = os.path.dirname(os.path.abspath(DATA_FILE)) or '.'
    fd, tmp_path = tempfile.mkstemp(prefix='.asl_db_', suffix='.tmp', dir=directory)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
        os.replace(tmp_path, DATA_FILE)
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/data', methods=['GET'])
def get_data():
    with _db_lock:
        return jsonify(load_data())


@app.route('/api/save_day', methods=['POST'])
def save_day():
    req = request.json
    day = str(req['day'])
    day_data = req['data']
    global_signs = req.get('global_signs', {})

    with _db_lock:
        db = load_data()
        db['days'][day] = day_data

        if global_signs:
            db['signs'] = global_signs

        save_data(db)
    return jsonify({"status": "success"})


@app.route('/api/save_sign', methods=['POST'])
def save_sign():
    req = request.json
    sign_name = req['name']
    sign_data = req['data']

    with _db_lock:
        db = load_data()
        db['signs'][sign_name] = sign_data
        save_data(db)

    return jsonify({"status": "success"})


@app.route('/api/delete_sign', methods=['POST'])
def delete_sign():
    req = request.json
    sign_name = req['name']

    with _db_lock:
        db = load_data()

        # Remove from global dictionary
        if sign_name in db['signs']:
            del db['signs'][sign_name]

        # Remove any spaced-repetition review data
        if 'review' in db and sign_name in db['review']:
            del db['review'][sign_name]

        # Remove from all logs
        for day, day_data in db['days'].items():
            if 'signs' in day_data and sign_name in day_data['signs']:
                day_data['signs'].remove(sign_name)

        save_data(db)
    return jsonify({"status": "success"})


@app.route('/api/save_tools', methods=['POST'])
def save_tools():
    req = request.json
    with _db_lock:
        db = load_data()
        db['tools'] = req['tools']
        save_data(db)
    return jsonify({"status": "success"})


@app.route('/api/save_curriculum', methods=['POST'])
def save_curriculum():
    req = request.json
    with _db_lock:
        db = load_data()
        db['curriculum_progress'] = req['progress']
        save_data(db)
    return jsonify({"status": "success"})


@app.route('/api/save_review', methods=['POST'])
def save_review():
    req = request.json
    review = req['review']  # { sign_name: {ease, interval, reps, due, lapses} }

    with _db_lock:
        db = load_data()
        if 'review' not in db:
            db['review'] = {}
        db['review'].update(review)
        save_data(db)
    return jsonify({"status": "success"})


if __name__ == '__main__':
    # threaded=False (the default) keeps writes serialized on top of the lock;
    # kept explicit here since that safety matters for this app.
    app.run(debug=True, threaded=False)