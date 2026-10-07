from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime, Table
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from database import Base

class RequestStatus(str, enum.Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"

# Group ও User-এর Many-to-Many রিলেশন টেবিল
group_members = Table(
    "group_members",
    Base.metadata,
    Column("group_id", Integer, ForeignKey("groups.id")),
    Column("user_id", Integer, ForeignKey("users.id"))
)

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    profile_image = Column(String, nullable=True)


class FriendRequest(Base):
    __tablename__ = "friend_requests"
    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"))
    receiver_id = Column(Integer, ForeignKey("users.id"))
    status = Column(String, default=RequestStatus.PENDING)

class Message(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"), index=True)
    receiver_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True) # 1-to-1 চ্যাটের জন্য
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=True, index=True)   # গ্রুপ চ্যাটের জন্য
    content = Column(String, nullable=True)
    msg_type = Column(String, default="text") # "text", "image", "document", "audio"
    file_url = Column(String, nullable=True)
    file_name = Column(String, nullable=True)
    file_size = Column(String, nullable=True)
    status = Column(String, default="sent") # "sent", "delivered", "seen"
    is_deleted_everyone = Column(Boolean, default=False)
    deleted_by_users = Column(String, default="") # e.g. ",1,2,"
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)



class Group(Base):
    __tablename__ = "groups"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    members = relationship("User", secondary=group_members, backref="groups")