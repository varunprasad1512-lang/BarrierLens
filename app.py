import os
import json
import sqlite3
import time

from flask import Flask, request, jsonify, session
from werkzeug.security import generate_password_hash, check_password_hash
from flask_cors import CORS
from dotenv import load_dotenv

from google import genai
from google.genai import types

load_dotenv()

app = Flask(__name__)

FLASK_SECRET_KEY = os.getenv("FLASK_SECRET_KEY", "fallback_secret_key")
app.secret_key = FLASK_SECRET_KEY

# Production cookie settings for cross-site Vercel <-> Railway communication
app.config["SESSION_COOKIE_SAMESITE"] = "None"
app.config["SESSION_COOKIE_SECURE"] = True
app.config["PERMANENT_SESSION_LIFETIME"] = 60 * 60 * 24

CORS_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:8080,http://127.0.0.1:8080,https://*.vercel.app"
).split(",")

CORS(
    app,
    origins=[origin.strip() for origin in CORS_ORIGINS if origin.strip()],
    supports_credentials=True
)

DATABASE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "barrierlens.db"
)

def get_db():
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    return connection

def initialize_database():
    connection = get_db()
    connection.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    connection.execute("""
        CREATE TABLE IF NOT EXISTS reports (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            user_name TEXT,
            user_email TEXT,
            category TEXT,
            barrier_type TEXT,
            severity TEXT,
            description TEXT,
            latitude REAL,
            longitude REAL,
            location TEXT,
            image_name TEXT,
            image_type TEXT,
            image_size INTEGER,
            attachments TEXT,
            ai_analysis TEXT,
            status TEXT DEFAULT 'submitted',
            created_at TEXT NOT NULL
        )
    """)
    connection.commit()
    connection.close()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

@app.route("/", methods=["GET"])
def home():
    return jsonify({"status": "online", "service": "BarrierLens AI Backend"})

@app.route("/api/analyze", methods=["POST"])
def analyze_image():
    try:
        if "image" not in request.files:
            return jsonify({"success": False, "error": "No image uploaded."}), 400

        image_file = request.files["image"]
        image_bytes = image_file.read()
        mime_type = image_file.mimetype or "image/jpeg"

        if not client:
            return jsonify({"success": False, "error": "AI client not configured."}), 500

        prompt = """Analyze the image and return ONLY valid JSON:
{
  "detected": true,
  "category": "surface",
  "barrier_type": "string",
  "confidence": 0.0,
  "severity": "low",
  "description": "string",
  "accessibility_impact": "string",
  "priority": "normal",
  "recommended_action": "string",
  "reasoning": ["string"]
}"""
        image_part = types.Part.from_bytes(data=image_bytes, mime_type=mime_type)
        response = client.models.generate_content(model="gemini-2.5-flash", contents=[prompt, image_part])
        
        result_text = (response.text or "").strip()
        if result_text.startswith("```"):
            result_text = result_text.replace("```json", "").replace("```", "").strip()

        return jsonify({"success": True, "analysis": json.loads(result_text)})
    except Exception as error:
        return jsonify({"success": False, "error": str(error)}), 500

@app.route("/api/reports", methods=["GET"])
def get_reports():
    try:
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"success": False, "error": "Authentication required."}), 401

        connection = get_db()
        rows = connection.execute("SELECT * FROM reports WHERE user_id = ? ORDER BY created_at DESC", (user_id,)).fetchall()
        connection.close()

        result = []
        for row in rows:
            report = dict(row)
            if report.get("attachments"):
                try: report["attachments"] = json.loads(report["attachments"])
                except: report["attachments"] = []
            if report.get("ai_analysis"):
                try: report["ai_analysis"] = json.loads(report["ai_analysis"])
                except: pass
            result.append(report)

        return jsonify({"success": True, "reports": result, "count": len(result)}), 200
    except Exception as error:
        return jsonify({"success": False, "error": str(error)}), 500

@app.route("/api/reports", methods=["POST"])
def create_report():
    try:
        data = request.get_json()
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"success": False, "error": "Authentication required."}), 401
        if not data:
            return jsonify({"success": False, "error": "No data received."}), 400

        connection = get_db()
        user_check = connection.execute("SELECT id, name, email FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user_check:
            connection.close()
            return jsonify({"success": False, "error": "User not found."}), 401

        connection.execute("""
            INSERT INTO reports (
                id, user_id, user_name, user_email, category, barrier_type,
                severity, description, latitude, longitude, location,
                image_name, image_type, image_size, attachments, ai_analysis, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            data["id"], user_id, user_check["name"], user_check["email"],
            data.get("category", ""), data.get("barrier_type", ""), data.get("severity", ""),
            data.get("description", ""), data.get("latitude"), data.get("longitude"),
            data.get("location", ""), data.get("image_name", ""), data.get("image_type", ""),
            data.get("image_size", 0), json.dumps(data.get("attachments", [])),
            json.dumps(data.get("ai_analysis")) if data.get("ai_analysis") else None,
            data.get("status", "submitted"), data["created_at"]
        ))
        connection.commit()
        connection.close()

        return jsonify({"success": True, "message": "Report saved.", "report_id": data["id"]}), 201
    except Exception as error:
        return jsonify({"success": False, "error": str(error)}), 500

@app.route("/api/reports/<report_id>", methods=["DELETE"])
def delete_report(report_id):
    try:
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"success": False, "error": "Authentication required."}), 401

        connection = get_db()
        cursor = connection.execute("DELETE FROM reports WHERE id = ? AND user_id = ?", (report_id, user_id))
        connection.commit()
        connection.close()

        if cursor.rowcount == 0:
            return jsonify({"success": False, "error": "Report not found."}), 404

        return jsonify({"success": True, "message": "Deleted successfully."}), 200
    except Exception as error:
        return jsonify({"success": False, "error": str(error)}), 500

@app.route("/api/register", methods=["POST"])
def register_user():
    try:
        data = request.get_json(silent=True) or {}
        name = str(data.get("name", "")).strip()
        email = str(data.get("email", "")).strip().lower()
        password = str(data.get("password", ""))

        if not name or not email or not password:
            return jsonify({"success": False, "error": "All fields required."}), 400

        connection = get_db()
        existing = connection.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if existing:
            connection.close()
            return jsonify({"success": False, "error": "Email already registered."}), 409

        user_id = f"USR-{int(time.time() * 1000)}"
        password_hash = generate_password_hash(password)

        connection.execute(
            "INSERT INTO users (id, name, email, password, created_at) VALUES (?, ?, ?, ?, ?)",
            (user_id, name, email, password_hash, time.strftime("%Y-%m-%d %H:%M:%S"))
        )
        connection.commit()
        connection.close()

        return jsonify({"success": True, "user": {"id": user_id, "name": name, "email": email}}), 201
    except Exception as error:
        return jsonify({"success": False, "error": str(error)}), 500

@app.route("/api/login", methods=["POST"])
def login_user():
    try:
        data = request.get_json(silent=True) or {}
        email = str(data.get("email", "")).strip().lower()
        password = str(data.get("password", ""))

        connection = get_db()
        user = connection.execute("SELECT id, name, email, password FROM users WHERE email = ?", (email,)).fetchone()
        connection.close()

        if not user or not check_password_hash(user["password"], password):
            return jsonify({"success": False, "error": "Invalid email or password."}), 401

        session["user_id"] = user["id"]
        return jsonify({"success": True, "user": {"id": user["id"], "name": user["name"], "email": user["email"]}}), 200
    except Exception as error:
        return jsonify({"success": False, "error": str(error)}), 500

@app.route("/api/logout", methods=["POST"])
def logout_user():
    session.clear()
    return jsonify({"success": True, "message": "Logged out."}), 200

@app.route("/api/session", methods=["GET"])
def check_session():
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"success": False, "authenticated": False}), 401

    try:
        connection = get_db()
        user = connection.execute("SELECT id, name, email FROM users WHERE id = ?", (user_id,)).fetchone()
        connection.close()

        if not user:
            session.clear()
            return jsonify({"success": False, "authenticated": False}), 401

        return jsonify({"success": True, "authenticated": True, "user": {"id": user["id"], "name": user["name"], "email": user["email"]}}), 200
    except Exception as error:
        return jsonify({"success": False, "authenticated": False, "error": str(error)}), 500

initialize_database()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=False)