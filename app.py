from flask import Flask, request, jsonify, render_template
import json
import os

app = Flask(__name__)
DATA_FILE = 'asl_database.json'

def load_data():
    if not os.path.exists(DATA_FILE):
        return {
            "days": {}, 
            "tools": [
                {"name": "Gemini Live", "link": "https://gemini.google.com/"}, 
                {"name": "Lifeprint", "link": "https://www.lifeprint.com/"}
            ],
            "signs": {},
            "curriculum_progress": {}
        }
    with open(DATA_FILE, 'r') as f:
        db = json.load(f)
        if "tools" not in db:
            db["tools"] = []
        if "days" not in db:
            db["days"] = {}
        if "curriculum_progress" not in db:
            db["curriculum_progress"] = {}
            
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
    with open(DATA_FILE, 'w') as f:
        json.dump(data, f, indent=4)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/data', methods=['GET'])
def get_data():
    return jsonify(load_data())

@app.route('/api/save_day', methods=['POST'])
def save_day():
    req = request.json
    day = str(req['day'])
    day_data = req['data']
    global_signs = req.get('global_signs', {})
    
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
    
    db = load_data()
    db['signs'][sign_name] = sign_data
    save_data(db)
    
    return jsonify({"status": "success"})

@app.route('/api/delete_sign', methods=['POST'])
def delete_sign():
    req = request.json
    sign_name = req['name']
    
    db = load_data()
    
    # Remove from global dictionary
    if sign_name in db['signs']:
        del db['signs'][sign_name]
        
    # Remove from all logs
    for day, day_data in db['days'].items():
        if 'signs' in day_data and sign_name in day_data['signs']:
            day_data['signs'].remove(sign_name)
            
    save_data(db)
    return jsonify({"status": "success"})

@app.route('/api/save_tools', methods=['POST'])
def save_tools():
    req = request.json
    db = load_data()
    db['tools'] = req['tools']
    save_data(db)
    return jsonify({"status": "success"})

@app.route('/api/save_curriculum', methods=['POST'])
def save_curriculum():
    req = request.json
    db = load_data()
    db['curriculum_progress'] = req['progress']
    save_data(db)
    return jsonify({"status": "success"})

if __name__ == '__main__':
    app.run(debug=True)