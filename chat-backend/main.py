import os
import json
import uuid
import base64
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from dotenv import load_dotenv
load_dotenv()

import requests
import bcrypt
from jose import JWTError, jwt
from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, Query, status, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy import text

import models
import schemas
from database import engine, get_db

# ডাটাবেজ টেবিল তৈরি ও কলাম মাইগ্রেশন চেক (PostgreSQL Neon DB)
models.Base.metadata.create_all(bind=engine)
try:
    with engine.connect() as conn:
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image VARCHAR;"))
        conn.execute(text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS msg_type VARCHAR DEFAULT 'text';"))
        conn.execute(text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_url VARCHAR;"))
        conn.execute(text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_name VARCHAR;"))
        conn.execute(text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_size VARCHAR;"))
        conn.execute(text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS status VARCHAR DEFAULT 'sent';"))
        conn.execute(text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_deleted_everyone BOOLEAN DEFAULT FALSE;"))
        conn.execute(text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_by_users VARCHAR DEFAULT '';"))
        conn.commit()
except Exception as e:
    print("Database column migration check notice:", e)

app = FastAPI(title="Realtime Chat API with Audio/Video Call & File Sharing")

# React Frontend এর জন্য CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_origin_regex=r"^https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Uploads directory setup for document/media storage
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

SECRET_KEY = os.getenv("SECRET_KEY", "SUPER_SECRET_CHAT_SECURITY_KEY_CHANGE_THIS")
ALGORITHM = "HS256"
IMGBB_API_KEY = os.getenv("IMGBB_API_KEY", "6f2066a27370f245f424cffff0bffd64")

# ----------------- ImgBB Upload Helper -----------------
def upload_image_to_imgbb(file_bytes: bytes, filename: str = "avatar.jpg", content_type: str = "image/jpeg") -> Optional[str]:
    """
    ImgBB API ব্যবহার করে ইমেজ আপলোড করে এবং পাবলিক URL রিটার্ন করে
    """
    try:
        files = {"image": (filename or "avatar.jpg", file_bytes, content_type or "image/jpeg")}
        data = {"key": IMGBB_API_KEY}
        headers = {"User-Agent": "Mozilla/5.0"}
        res = requests.post(
            "https://api.imgbb.com/1/upload",
            data=data,
            files=files,
            headers=headers,
            timeout=25
        )
        res_data = res.json()
        if res.status_code == 200 and res_data.get("success"):
            return res_data["data"]["url"]
        print("ImgBB API upload response:", res_data)
        return None
    except Exception as e:
        print("ImgBB upload error:", e)
        return None

# ----------------- Password Hashing (Bcrypt) -----------------
def hash_password(password: str) -> str:
    pwd_bytes = password.encode('utf-8')[:72]
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pwd_bytes, salt).decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    pwd_bytes = plain_password.encode('utf-8')[:72]
    hash_bytes = hashed_password.encode('utf-8')
    return bcrypt.checkpw(pwd_bytes, hash_bytes)

# ----------------- JWT Token Utils -----------------
def create_access_token(data: dict):
    to_encode = data.copy()
    to_encode.update({"exp": datetime.utcnow() + timedelta(days=7)})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user_from_token(token: str, db: Session):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            return None
        return db.query(models.User).filter(models.User.username == username).first()
    except JWTError:
        return None

# ----------------- WebSocket Manager -----------------
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[int, List[WebSocket]] = {}

    def is_online(self, user_id: int) -> bool:
        return user_id in self.active_connections and len(self.active_connections[user_id]) > 0

    def get_online_users(self) -> List[int]:
        return list(self.active_connections.keys())

    async def connect(self, user_id: int, websocket: WebSocket):
        await websocket.accept()
        is_first = user_id not in self.active_connections or len(self.active_connections[user_id]) == 0
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)

        # 1. Send current list of online users to the newly connected user
        try:
            await websocket.send_text(json.dumps({
                "type": "presence-initial",
                "online_user_ids": self.get_online_users()
            }))
        except Exception:
            pass

        # 2. If this user just came online, broadcast to everyone
        if is_first:
            await self.broadcast_all({
                "type": "presence-change",
                "user_id": user_id,
                "status": "online"
            })

    async def disconnect(self, user_id: int, websocket: WebSocket):
        if user_id in self.active_connections:
            if websocket in self.active_connections[user_id]:
                self.active_connections[user_id].remove(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
                # Broadcast offline status to everyone
                await self.broadcast_all({
                    "type": "presence-change",
                    "user_id": user_id,
                    "status": "offline"
                })

    async def send_to_user(self, user_id: int, data: dict):
        if user_id in self.active_connections:
            for conn in list(self.active_connections[user_id]):
                try:
                    await conn.send_text(json.dumps(data))
                except Exception:
                    pass

    async def broadcast_to_group(self, member_ids: List[int], data: dict):
        for uid in member_ids:
            await self.send_to_user(uid, data)

    async def broadcast_all(self, data: dict):
        for uid, connections in list(self.active_connections.items()):
            for conn in list(connections):
                try:
                    await conn.send_text(json.dumps(data))
                except Exception:
                    pass

manager = ConnectionManager()

# ----------------- Auth & User Endpoints -----------------
@app.post("/api/register")
async def register(
    request: Request,
    db: Session = Depends(get_db)
):
    """
    রেজিস্ট্রেশন: ইউজারনেম, পাসওয়ার্ড এবং অপশনাল প্রোফাইল ইমেজ (file upload অথবা base64/url) গ্রহণ করে
    """
    content_type = request.headers.get("content-type", "")
    username = ""
    password = ""
    profile_image_url = None

    if "multipart/form-data" in content_type or "application/x-www-form-urlencoded" in content_type:
        form = await request.form()
        username = form.get("username", "")
        password = form.get("password", "")
        file_obj = form.get("profile_image") or form.get("image") or form.get("file")

        if file_obj and hasattr(file_obj, "read"):
            file_bytes = await file_obj.read()
            if len(file_bytes) > 0:
                filename = getattr(file_obj, "filename", "avatar.jpg")
                ctype = getattr(file_obj, "content_type", "image/jpeg")
                profile_image_url = upload_image_to_imgbb(file_bytes, filename, ctype)
                if not profile_image_url:
                    # Fallback to local uploads
                    safe_name = f"avatar_{uuid.uuid4().hex[:8]}_{filename}"
                    with open(os.path.join(UPLOAD_DIR, safe_name), "wb") as f:
                        f.write(file_bytes)
                    profile_image_url = f"/uploads/{safe_name}"
        elif isinstance(file_obj, str) and file_obj.strip():
            profile_image_url = file_obj.strip()
    else:
        # JSON Payload
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON body")
        username = body.get("username", "")
        password = body.get("password", "")
        img_str = body.get("profile_image") or body.get("image")
        if img_str and isinstance(img_str, str):
            if img_str.startswith("http://") or img_str.startswith("https://") or img_str.startswith("/uploads/"):
                profile_image_url = img_str
            elif "base64," in img_str:
                try:
                    header, b64data = img_str.split("base64,", 1)
                    c_type = header.split(";")[0].replace("data:", "") or "image/jpeg"
                    raw_bytes = base64.b64decode(b64data)
                    profile_image_url = upload_image_to_imgbb(raw_bytes, "avatar.jpg", c_type)
                except Exception as e:
                    print("Base64 image decode error:", e)

    username = str(username).strip()
    password = str(password).strip()

    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password are required")

    if db.query(models.User).filter(models.User.username == username).first():
        raise HTTPException(status_code=400, detail="Username already taken")

    hashed = hash_password(password)
    new_user = models.User(
        username=username,
        hashed_password=hashed,
        profile_image=profile_image_url
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return {
        "message": "Account created successfully",
        "user": {
            "id": new_user.id,
            "username": new_user.username,
            "profile_image": new_user.profile_image
        }
    }

@app.post("/api/login")
def login(user: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.username == user.username).first()
    if not db_user or not verify_password(user.password, db_user.hashed_password):
        raise HTTPException(status_code=400, detail="Invalid username or password")

    token = create_access_token({
        "sub": db_user.username,
        "user_id": db_user.id,
        "profile_image": db_user.profile_image
    })
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": db_user.id,
            "username": db_user.username,
            "profile_image": db_user.profile_image
        }
    }

@app.get("/api/me")
def get_me(token: str, db: Session = Depends(get_db)):
    user = get_current_user_from_token(token, db)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return {
        "id": user.id,
        "username": user.username,
        "profile_image": user.profile_image
    }

# ----------------- File / Document / Image Upload -----------------
@app.post("/api/upload-file")
async def upload_file(file: UploadFile = File(...)):
    """
    ডকুমেন্ট, পিডিএফ, ইমেজ ইত্যাদি ফাইল আপলোড করার এন্ডপয়েন্ট
    """
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file provided")
    
    original_filename = file.filename or "file.bin"
    file_ext = os.path.splitext(original_filename)[1].lower()
    content_type = file.content_type or "application/octet-stream"
    
    # Calculate formatted size
    size_bytes = len(content)
    if size_bytes < 1024:
        size_str = f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        size_str = f"{size_bytes / 1024:.1f} KB"
    else:
        size_str = f"{size_bytes / (1024 * 1024):.1f} MB"

    is_image = content_type.startswith("image/") or file_ext in [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]
    msg_type = "image" if is_image else "document"

    file_url = None
    if is_image:
        file_url = upload_image_to_imgbb(content, original_filename, content_type)
    
    # Fallback or for docs/PDF/audio
    if not file_url:
        safe_name = f"{uuid.uuid4().hex[:10]}_{original_filename.replace(' ', '_')}"
        file_path = os.path.join(UPLOAD_DIR, safe_name)
        with open(file_path, "wb") as f:
            f.write(content)
        file_url = f"/uploads/{safe_name}"

    return {
        "url": file_url,
        "file_name": original_filename,
        "file_size": size_str,
        "msg_type": msg_type,
        "content_type": content_type
    }

@app.post("/api/upload-image")
async def upload_image(file: UploadFile = File(...)):
    return await upload_file(file)

# ----------------- Friend Requests -----------------
@app.post("/api/friend-request/send/{receiver_id}")
def send_request(receiver_id: int, token: str, db: Session = Depends(get_db)):
    user = get_current_user_from_token(token, db)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if user.id == receiver_id:
        raise HTTPException(status_code=400, detail="You cannot send a request to yourself")

    target = db.query(models.User).filter(models.User.id == receiver_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    existing = db.query(models.FriendRequest).filter(
        ((models.FriendRequest.sender_id == user.id) & (models.FriendRequest.receiver_id == receiver_id)) |
        ((models.FriendRequest.sender_id == receiver_id) & (models.FriendRequest.receiver_id == user.id))
    ).first()

    if existing:
        return {"message": f"Connection already exists with status: {existing.status}"}

    req = models.FriendRequest(sender_id=user.id, receiver_id=receiver_id)
    db.add(req)
    db.commit()
    return {"message": "Friend request sent successfully"}

@app.post("/api/friend-request/respond")
def respond_request(payload: schemas.FriendRequestAction, token: str, db: Session = Depends(get_db)):
    user = get_current_user_from_token(token, db)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")

    req = db.query(models.FriendRequest).filter(
        models.FriendRequest.id == payload.request_id,
        models.FriendRequest.receiver_id == user.id
    ).first()

    if not req:
        raise HTTPException(status_code=404, detail="Friend request not found")

    req.status = models.RequestStatus.ACCEPTED if payload.action == "accept" else models.RequestStatus.REJECTED
    db.commit()
    return {"message": f"Request {payload.action}ed"}

@app.get("/api/friends")
def get_friends(token: str, db: Session = Depends(get_db)):
    user = get_current_user_from_token(token, db)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")

    accepted = db.query(models.FriendRequest).filter(
        ((models.FriendRequest.sender_id == user.id) | (models.FriendRequest.receiver_id == user.id)),
        models.FriendRequest.status == models.RequestStatus.ACCEPTED
    ).all()

    friend_ids = [r.receiver_id if r.sender_id == user.id else r.sender_id for r in accepted]
    friends = db.query(models.User).filter(models.User.id.in_(friend_ids)).all()
    return [
        {
            "id": f.id,
            "username": f.username,
            "profile_image": f.profile_image
        }
        for f in friends
    ]

# ----------------- Groups -----------------
@app.post("/api/groups")
def create_group(group_data: schemas.GroupCreate, token: str, db: Session = Depends(get_db)):
    user = get_current_user_from_token(token, db)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")

    members = db.query(models.User).filter(models.User.id.in_(group_data.member_ids + [user.id])).all()
    new_group = models.Group(name=group_data.name, members=members)
    db.add(new_group)
    db.commit()
    return {"message": "Group created", "group_id": new_group.id}

@app.get("/api/groups")
def get_user_groups(token: str, db: Session = Depends(get_db)):
    user = get_current_user_from_token(token, db)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return [{"id": g.id, "name": g.name} for g in user.groups]

# ----------------- Online Presence Endpoint -----------------
@app.get("/api/users/online")
def get_online_users():
    return {"online_user_ids": manager.get_online_users()}

# ----------------- WebSocket Realtime (Chat, Presence, Delivery/Seen, Deletion & WebRTC) -----------------
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(...), db: Session = Depends(get_db)):
    user = get_current_user_from_token(token, db)
    if not user:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await manager.connect(user.id, websocket)

    # When user connects, mark any pending direct messages sent to them as 'delivered'
    try:
        pending_msgs = db.query(models.Message).filter(
            models.Message.receiver_id == user.id,
            models.Message.status == "sent"
        ).all()
        if pending_msgs:
            sender_ids = set()
            for m in pending_msgs:
                m.status = "delivered"
                sender_ids.add(m.sender_id)
            db.commit()
            for sid in sender_ids:
                await manager.send_to_user(sid, {
                    "type": "messages-delivered",
                    "by_user_id": user.id,
                    "chat_id": user.id
                })
    except Exception as e:
        print("Auto-delivered update error on WS connect:", e)

    try:
        while True:
            data_raw = await websocket.receive_text()
            data = json.loads(data_raw)

            msg_type = data.get("type")
            target_id = data.get("target_id")

            # === WebRTC Audio & Video Call Signaling ===
            if msg_type == "call-request":
                call_type = data.get("call_type", "video") # "video" or "audio"
                payload = {
                    "type": "call-incoming",
                    "call_type": call_type,
                    "caller_id": user.id,
                    "caller_name": user.username,
                    "caller_avatar": user.profile_image
                }
                await manager.send_to_user(target_id, payload)
                continue

            elif msg_type == "call-accept":
                payload = {
                    "type": "call-accepted",
                    "receiver_id": user.id,
                    "receiver_name": user.username,
                    "receiver_avatar": user.profile_image
                }
                await manager.send_to_user(target_id, payload)
                continue

            elif msg_type == "call-reject":
                payload = {
                    "type": "call-rejected",
                    "receiver_id": user.id,
                    "reason": data.get("reason", "declined")
                }
                await manager.send_to_user(target_id, payload)
                continue

            elif msg_type == "call-end":
                payload = {
                    "type": "call-ended",
                    "sender_id": user.id
                }
                await manager.send_to_user(target_id, payload)
                continue

            elif msg_type == "webrtc-signal":
                payload = {
                    "type": "webrtc-signal",
                    "sender_id": user.id,
                    "signal": data.get("signal")
                }
                await manager.send_to_user(target_id, payload)
                continue

            # === Mark Messages as Seen ===
            elif msg_type == "mark-seen":
                other_user_id = data.get("chat_id") or target_id
                if other_user_id:
                    unseen_msgs = db.query(models.Message).filter(
                        models.Message.sender_id == other_user_id,
                        models.Message.receiver_id == user.id,
                        models.Message.status != "seen"
                    ).all()
                    if unseen_msgs:
                        for m in unseen_msgs:
                            m.status = "seen"
                        db.commit()
                        await manager.send_to_user(other_user_id, {
                            "type": "messages-seen",
                            "seen_by_user_id": user.id,
                            "chat_id": user.id
                        })
                continue

            # === Delete Message via WebSocket ===
            elif msg_type == "delete-message":
                msg_id = data.get("message_id")
                delete_type = data.get("delete_type", "me") # "everyone" | "me"
                msg = db.query(models.Message).filter(models.Message.id == msg_id).first()
                if msg:
                    if delete_type == "everyone" and msg.sender_id == user.id:
                        msg.is_deleted_everyone = True
                        msg.content = "This message was deleted"
                        msg.file_url = None
                        msg.file_name = None
                        msg.file_size = None
                        msg.msg_type = "deleted"
                        db.commit()

                        del_payload = {
                            "type": "message-deleted",
                            "message_id": msg.id,
                            "delete_type": "everyone",
                            "content": "This message was deleted",
                            "msg_type": "deleted",
                            "chat_type": "direct" if msg.receiver_id else "group",
                            "target_id": msg.receiver_id if msg.sender_id == user.id else user.id,
                            "group_id": msg.group_id
                        }
                        if msg.receiver_id:
                            await manager.send_to_user(msg.sender_id, del_payload)
                            await manager.send_to_user(msg.receiver_id, del_payload)
                        elif msg.group_id:
                            group = db.query(models.Group).filter(models.Group.id == msg.group_id).first()
                            if group:
                                await manager.broadcast_to_group([m.id for m in group.members], del_payload)
                    elif delete_type == "me":
                        tag = f",{user.id},"
                        curr = msg.deleted_by_users or ""
                        if tag not in curr:
                            msg.deleted_by_users = curr + tag
                            db.commit()
                        await manager.send_to_user(user.id, {
                            "type": "message-deleted",
                            "message_id": msg.id,
                            "delete_type": "me"
                        })
                continue

            # === Direct Chat Messages (Text, Image, Document, Audio, Emoji) ===
            elif msg_type == "direct":
                relation = db.query(models.FriendRequest).filter(
                    ((models.FriendRequest.sender_id == user.id) & (models.FriendRequest.receiver_id == target_id)) |
                    ((models.FriendRequest.sender_id == target_id) & (models.FriendRequest.receiver_id == user.id)),
                    models.FriendRequest.status == models.RequestStatus.ACCEPTED
                ).first()

                if not relation:
                    await websocket.send_text(json.dumps({
                        "error": "Cannot send message. Friend request has not been accepted yet."
                    }))
                    continue

                # Recipient online check: if online -> 'delivered', else 'sent'
                is_target_online = manager.is_online(target_id)
                msg_status = "delivered" if is_target_online else "sent"

                msg = models.Message(
                    sender_id=user.id,
                    receiver_id=target_id,
                    content=data.get("content", ""),
                    msg_type=data.get("msg_type", "text"),
                    file_url=data.get("file_url"),
                    file_name=data.get("file_name"),
                    file_size=data.get("file_size"),
                    status=msg_status
                )
                db.add(msg)
                db.commit()
                db.refresh(msg)

                payload = {
                    "type": "direct",
                    "id": msg.id,
                    "sender_id": user.id,
                    "sender_name": user.username,
                    "sender_profile_image": user.profile_image,
                    "content": msg.content,
                    "msg_type": msg.msg_type,
                    "file_url": msg.file_url,
                    "file_name": msg.file_name,
                    "file_size": msg.file_size,
                    "status": msg.status,
                    "is_deleted_everyone": False,
                    "timestamp": str(msg.timestamp),
                    "target_id": target_id
                }
                await manager.send_to_user(target_id, payload)
                await manager.send_to_user(user.id, payload)

            # === Group Chat Messages ===
            elif msg_type == "group":
                group = db.query(models.Group).filter(models.Group.id == target_id).first()
                if not group or user not in group.members:
                    await websocket.send_text(json.dumps({
                        "error": "You are not a member of this group."
                    }))
                    continue

                msg = models.Message(
                    sender_id=user.id,
                    group_id=target_id,
                    content=data.get("content", ""),
                    msg_type=data.get("msg_type", "text"),
                    file_url=data.get("file_url"),
                    file_name=data.get("file_name"),
                    file_size=data.get("file_size"),
                    status="sent"
                )
                db.add(msg)
                db.commit()
                db.refresh(msg)

                payload = {
                    "type": "group",
                    "id": msg.id,
                    "group_id": target_id,
                    "sender_id": user.id,
                    "sender_name": user.username,
                    "sender_profile_image": user.profile_image,
                    "content": msg.content,
                    "msg_type": msg.msg_type,
                    "file_url": msg.file_url,
                    "file_name": msg.file_name,
                    "file_size": msg.file_size,
                    "status": "sent",
                    "is_deleted_everyone": False,
                    "timestamp": str(msg.timestamp)
                }
                member_ids = [m.id for m in group.members]
                await manager.broadcast_to_group(member_ids, payload)

    except WebSocketDisconnect:
        await manager.disconnect(user.id, websocket)
    except Exception:
        await manager.disconnect(user.id, websocket)

# ----------------- Get Pending Received Requests -----------------
@app.get("/api/friend-requests/pending")
def get_pending_requests(token: str, db: Session = Depends(get_db)):
    user = get_current_user_from_token(token, db)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")

    pending = db.query(models.FriendRequest).filter(
        models.FriendRequest.receiver_id == user.id,
        models.FriendRequest.status == models.RequestStatus.PENDING
    ).all()

    results = []
    for req in pending:
        sender = db.query(models.User).filter(models.User.id == req.sender_id).first()
        if sender:
            results.append({
                "request_id": req.id,
                "sender_id": sender.id,
                "sender_username": sender.username,
                "sender_profile_image": sender.profile_image
            })
    return results

# ----------------- Get Chat History & Mark Seen -----------------
@app.get("/api/messages/direct/{other_user_id}")
async def get_direct_messages(other_user_id: int, token: str, db: Session = Depends(get_db)):
    user = get_current_user_from_token(token, db)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")

    # When opening conversation, mark unseen messages from other user as 'seen'
    unseen = db.query(models.Message).filter(
        models.Message.sender_id == other_user_id,
        models.Message.receiver_id == user.id,
        models.Message.status != "seen"
    ).all()
    if unseen:
        for m in unseen:
            m.status = "seen"
        db.commit()
        await manager.send_to_user(other_user_id, {
            "type": "messages-seen",
            "seen_by_user_id": user.id,
            "chat_id": user.id
        })

    messages = db.query(models.Message).filter(
        ((models.Message.sender_id == user.id) & (models.Message.receiver_id == other_user_id)) |
        ((models.Message.sender_id == other_user_id) & (models.Message.receiver_id == user.id))
    ).order_by(models.Message.timestamp.asc()).all()

    user_tag = f",{user.id},"
    result = []
    for m in messages:
        # Check if deleted only for this user
        if user_tag in (m.deleted_by_users or ""):
            continue

        is_deleted = bool(m.is_deleted_everyone)
        sender = db.query(models.User).filter(models.User.id == m.sender_id).first()
        result.append({
            "id": m.id,
            "type": "direct",
            "sender_id": m.sender_id,
            "sender_name": sender.username if sender else "Unknown",
            "sender_profile_image": sender.profile_image if sender else None,
            "target_id": m.receiver_id if m.sender_id == user.id else user.id,
            "content": "This message was deleted" if is_deleted else m.content,
            "msg_type": "deleted" if is_deleted else (m.msg_type or "text"),
            "file_url": None if is_deleted else m.file_url,
            "file_name": None if is_deleted else m.file_name,
            "file_size": None if is_deleted else m.file_size,
            "status": m.status or "sent",
            "is_deleted_everyone": is_deleted,
            "timestamp": str(m.timestamp)
        })
    return result

@app.get("/api/messages/group/{group_id}")
def get_group_messages(group_id: int, token: str, db: Session = Depends(get_db)):
    user = get_current_user_from_token(token, db)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")

    group = db.query(models.Group).filter(models.Group.id == group_id).first()
    if not group or user not in group.members:
        raise HTTPException(status_code=403, detail="Not a group member")

    messages = db.query(models.Message).filter(
        models.Message.group_id == group_id
    ).order_by(models.Message.timestamp.asc()).all()

    user_tag = f",{user.id},"
    result = []
    for m in messages:
        if user_tag in (m.deleted_by_users or ""):
            continue

        is_deleted = bool(m.is_deleted_everyone)
        sender = db.query(models.User).filter(models.User.id == m.sender_id).first()
        result.append({
            "id": m.id,
            "type": "group",
            "group_id": m.group_id,
            "sender_id": m.sender_id,
            "sender_name": sender.username if sender else "Unknown",
            "sender_profile_image": sender.profile_image if sender else None,
            "content": "This message was deleted" if is_deleted else m.content,
            "msg_type": "deleted" if is_deleted else (m.msg_type or "text"),
            "file_url": None if is_deleted else m.file_url,
            "file_name": None if is_deleted else m.file_name,
            "file_size": None if is_deleted else m.file_size,
            "status": m.status or "sent",
            "is_deleted_everyone": is_deleted,
            "timestamp": str(m.timestamp)
        })
    return result

# ----------------- Message Deletion HTTP Endpoint -----------------
@app.post("/api/messages/delete")
async def delete_message_endpoint(payload: schemas.MessageDelete, token: str, db: Session = Depends(get_db)):
    user = get_current_user_from_token(token, db)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")

    msg = db.query(models.Message).filter(models.Message.id == payload.message_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    if payload.delete_type == "everyone":
        if msg.sender_id != user.id:
            raise HTTPException(status_code=403, detail="You can only delete your own messages for everyone")

        msg.is_deleted_everyone = True
        msg.content = "This message was deleted"
        msg.file_url = None
        msg.file_name = None
        msg.file_size = None
        msg.msg_type = "deleted"
        db.commit()

        del_event = {
            "type": "message-deleted",
            "message_id": msg.id,
            "delete_type": "everyone",
            "content": "This message was deleted",
            "msg_type": "deleted",
            "chat_type": "direct" if msg.receiver_id else "group",
            "target_id": msg.receiver_id if msg.sender_id == user.id else user.id,
            "group_id": msg.group_id
        }
        if msg.receiver_id:
            await manager.send_to_user(msg.sender_id, del_event)
            await manager.send_to_user(msg.receiver_id, del_event)
        elif msg.group_id:
            group = db.query(models.Group).filter(models.Group.id == msg.group_id).first()
            if group:
                await manager.broadcast_to_group([m.id for m in group.members], del_event)
        return {"status": "deleted_everyone", "message_id": msg.id}

    elif payload.delete_type == "me":
        tag = f",{user.id},"
        curr = msg.deleted_by_users or ""
        if tag not in curr:
            msg.deleted_by_users = curr + tag
            db.commit()

        await manager.send_to_user(user.id, {
            "type": "message-deleted",
            "message_id": msg.id,
            "delete_type": "me"
        })
        return {"status": "deleted_me", "message_id": msg.id}

    raise HTTPException(status_code=400, detail="Invalid delete_type. Must be 'everyone' or 'me'")

# ----------------- Mark Seen HTTP Endpoint -----------------
@app.post("/api/messages/mark-seen")
async def mark_messages_seen_endpoint(payload: schemas.MessageSeen, token: str, db: Session = Depends(get_db)):
    user = get_current_user_from_token(token, db)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")

    unseen = db.query(models.Message).filter(
        models.Message.sender_id == payload.chat_id,
        models.Message.receiver_id == user.id,
        models.Message.status != "seen"
    ).all()

    if unseen:
        for m in unseen:
            m.status = "seen"
        db.commit()
        await manager.send_to_user(payload.chat_id, {
            "type": "messages-seen",
            "seen_by_user_id": user.id,
            "chat_id": user.id
        })
    return {"status": "ok", "updated": len(unseen)}