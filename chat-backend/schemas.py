from pydantic import BaseModel
from typing import List, Optional

class UserCreate(BaseModel):
    username: str
    password: str
    profile_image: Optional[str] = None

class UserResponse(BaseModel):
    id: int
    username: str
    profile_image: Optional[str] = None

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str
    user: Optional[UserResponse] = None

class FriendRequestAction(BaseModel):
    request_id: int
    action: str  # "accept" অথবা "reject"

class GroupCreate(BaseModel):
    name: str
    member_ids: List[int]

class MessageDelete(BaseModel):
    message_id: int
    delete_type: str  # "everyone" or "me"

class MessageSeen(BaseModel):
    chat_id: int
    chat_type: str = "direct"