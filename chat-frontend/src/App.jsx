import React, { useState, useEffect, useRef } from "react";
import API, { getApiBaseUrl, getWsBaseUrl } from "./api";
import {
  Phone,
  PhoneOff,
  Video,
  VideoOff,
  Mic,
  MicOff,
  Paperclip,
  Smile,
  Send,
  User,
  Users,
  Plus,
  X,
  ArrowLeft,
  LogOut,
  FileText,
  Download,
  Sparkles,
  Search,
  Check,
  CheckCheck,
  Trash2,
  Ban
} from "lucide-react";

// WebRTC STUN Server Config
const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

// Popular Emojis
const EMOJI_LIST = [
  "😀", "😂", "😍", "🥳", "😎", "🔥", "👍", "❤️", "🙌", "🎉",
  "👋", "✨", "💯", "🚀", "💡", "🤔", "👏", "😊", "🥺", "😇",
  "👌", "💪", "🤩", "😴", "😭", "🤯", "🥰", "😜", "🎈", "🍻"
];

// Resolves relative / absolute media URLs across deployed domains
const getFileUrl = (url) => {
  if (!url) return "";
  if (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("blob:") ||
    url.startsWith("data:")
  ) {
    return url;
  }
  const baseUrl = typeof getApiBaseUrl === "function"
    ? getApiBaseUrl()
    : (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "");
  return `${baseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
};

export default function App() {
  // Auth state
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [currentUser, setCurrentUser] = useState(
    JSON.parse(localStorage.getItem("user") || "null")
  );
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [profileImageFile, setProfileImageFile] = useState(null);
  const [profileImagePreview, setProfileImagePreview] = useState("");
  const [authError, setAuthError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(false);

  // Dynamic Backend Server URL config
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [currentServerUrl, setCurrentServerUrl] = useState(
    typeof getApiBaseUrl === "function" ? getApiBaseUrl() : "http://localhost:8000"
  );
  const [customServerInput, setCustomServerInput] = useState(
    typeof getApiBaseUrl === "function" ? getApiBaseUrl() : "http://localhost:8000"
  );

  const handleSaveServerUrl = () => {
    if (!customServerInput.trim()) {
      localStorage.removeItem("custom_api_url");
    } else {
      let cleanUrl = customServerInput.trim().replace(/\/$/, "");
      if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
        cleanUrl = "https://" + cleanUrl;
      }
      localStorage.setItem("custom_api_url", cleanUrl);
    }
    const updated = typeof getApiBaseUrl === "function" ? getApiBaseUrl() : "http://localhost:8000";
    setCurrentServerUrl(updated);
    setCustomServerInput(updated);
    setShowServerConfig(false);
    setAuthError("");
    if (ws.current) {
      try {
        ws.current.close();
      } catch (e) {}
      ws.current = null;
    }
  };

  // App Data states & Loading states (for Skeletons)
  const [friends, setFriends] = useState([]);
  const [groups, setGroups] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [activeChat, setActiveChat] = useState(null); // { type: 'direct'|'group', id, name, profile_image }
  const [messages, setMessages] = useState([]);
  const [textInput, setTextInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Real Online Presence state
  const [onlineUserIds, setOnlineUserIds] = useState(new Set());

  // Staged File Attachment state (Selected before sending)
  const [stagedFile, setStagedFile] = useState(null); // { file, name, sizeFormatted, isImage, previewUrl }

  // Message Delete Modal state
  const [deleteModalMsg, setDeleteModalMsg] = useState(null);

  // Modals & Popovers
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [selectedGroupMembers, setSelectedGroupMembers] = useState([]);
  const [targetUserId, setTargetUserId] = useState("");
  const [friendStatusMsg, setFriendStatusMsg] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [lightboxImage, setLightboxImage] = useState(null);

  // Call States (Audio & Video)
  const [callState, setCallState] = useState("idle"); // 'idle' | 'calling' | 'incoming' | 'connected'
  const [callType, setCallType] = useState("audio"); // 'video' | 'audio'
  const [callerInfo, setCallerInfo] = useState(null); // { id, name, avatar }
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoDisabled, setIsVideoDisabled] = useState(false);

  // Responsive state (Robust detection for mobile devices & tablets up to 860px)
  const checkIsMobile = () => {
    if (typeof window === "undefined") return false;
    return (
      window.innerWidth <= 860 ||
      window.matchMedia("(max-width: 860px)").matches
    );
  };
  const [isMobile, setIsMobile] = useState(checkIsMobile());

  // Refs
  const ws = useRef(null);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const fileInputRef = useRef(null);
  const pc = useRef(null);
  const localStream = useRef(null);
  const remoteStream = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const iceCandidatesQueue = useRef([]);
  const callTimerRef = useRef(null);
  const ringtoneStopRef = useRef(null);
  const activeChatRef = useRef(activeChat);
  const callTypeRef = useRef(callType);
  const callerInfoRef = useRef(callerInfo);
  const reconnectTimeoutRef = useRef(null);

  useEffect(() => {
    activeChatRef.current = activeChat;
  }, [activeChat]);

  useEffect(() => {
    callTypeRef.current = callType;
  }, [callType]);

  useEffect(() => {
    callerInfoRef.current = callerInfo;
  }, [callerInfo]);

  // Handle window resize & orientation change
  useEffect(() => {
    const handleResize = () => setIsMobile(checkIsMobile());
    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
  }, []);

  // Keyboard shortcut to close chat or modals on Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        if (lightboxImage) setLightboxImage(null);
        else if (deleteModalMsg) setDeleteModalMsg(null);
        else if (showGroupModal) setShowGroupModal(false);
        else if (showEmojiPicker) setShowEmojiPicker(false);
        else if (activeChat && callState === "idle") setActiveChat(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightboxImage, deleteModalMsg, showGroupModal, showEmojiPicker, activeChat, callState]);

  // Background Session Verification (Non-blocking instant load)
  useEffect(() => {
    if (!token) return;
    API.get(`/api/me?token=${token}`)
      .then((res) => {
        setCurrentUser(res.data);
        localStorage.setItem("user", JSON.stringify(res.data));
      })
      .catch((err) => {
        if (err?.response?.status === 401 || err?.response?.status === 403) {
          handleLogout();
        }
      });
  }, [token]);

  // Load Contacts, Groups & Presence (Resilient Promise.allSettled)
  const loadInitialData = async () => {
    if (!token) return;
    try {
      const [friendsRes, groupsRes, pendingRes, onlineRes] = await Promise.allSettled([
        API.get(`/api/friends?token=${token}`),
        API.get(`/api/groups?token=${token}`),
        API.get(`/api/friend-requests/pending?token=${token}`),
        API.get(`/api/users/online`),
      ]);
      if (friendsRes.status === "fulfilled") setFriends(friendsRes.value.data || []);
      if (groupsRes.status === "fulfilled") setGroups(groupsRes.value.data || []);
      if (pendingRes.status === "fulfilled") setPendingRequests(pendingRes.value.data || []);
      if (onlineRes.status === "fulfilled" && onlineRes.value?.data?.online_user_ids) {
        setOnlineUserIds(new Set((onlineRes.value.data.online_user_ids || []).map(Number)));
      }
    } catch (err) {
      console.warn("Initial data load deferred:", err);
    } finally {
      setLoadingContacts(false);
    }
  };

  useEffect(() => {
    loadInitialData();
  }, [token]);

  // WebSocket Setup with Auto-Reconnect and Visibility/Foreground Detection
  useEffect(() => {
    if (!token) return;

    const connectWebSocket = () => {
      if (!token) return;
      if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
        return;
      }

      try {
        const resolveWsUrl = (tok) => {
          try {
            if (typeof getWsBaseUrl === "function") return `${getWsBaseUrl()}?token=${tok}`;
          } catch (e) {
            console.warn("getWsBaseUrl fallback", e);
          }
          const base = (typeof getApiBaseUrl === "function" ? getApiBaseUrl() : (import.meta.env.VITE_API_URL || "http://localhost:8000")).replace(/\/$/, "");
          const isHttps = base.startsWith("https");
          const clean = base.replace(/^https?:\/\//, "").replace(/\/$/, "");
          return `${isHttps ? "wss" : "ws"}://${clean}/ws?token=${tok}`;
        };

        const wsUrl = resolveWsUrl(token);
        const socket = new WebSocket(wsUrl);
        ws.current = socket;

        socket.onopen = () => {
          console.log("WebSocket connected successfully!");
          loadInitialData();
        };

        socket.onerror = (e) => {
          console.warn("WebSocket status: waiting for server connection", e);
        };

        socket.onclose = () => {
          console.warn("WebSocket disconnected. Auto-reconnecting in 2s...");
          ws.current = null;
          if (token) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = setTimeout(connectWebSocket, 2000);
          }
        };

        socket.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.error) {
          alert(`Notice: ${data.error}`);
          return;
        }

        // Realtime Online Presence
        if (data.type === "presence-initial") {
          setOnlineUserIds(new Set((data.online_user_ids || []).map(Number)));
          return;
        }

        if (data.type === "presence-change") {
          setOnlineUserIds((prev) => {
            const next = new Set(prev);
            const uid = Number(data.user_id);
            if (data.status === "online") next.add(uid);
            else next.delete(uid);
            return next;
          });
          return;
        }

        // Realtime Delivery Receipt
        if (data.type === "messages-delivered") {
          setMessages((prev) =>
            prev.map((m) =>
              (m.target_id === data.delivered_to_user_id || m.target_id === data.chat_id) &&
                m.status === "sent"
                ? { ...m, status: "delivered" }
                : m
            )
          );
          return;
        }

        // Realtime Read/Seen Receipt
        if (data.type === "messages-seen") {
          setMessages((prev) =>
            prev.map((m) =>
              (m.target_id === data.seen_by_user_id || m.target_id === data.chat_id) &&
                m.status !== "seen"
                ? { ...m, status: "seen" }
                : m
            )
          );
          return;
        }

        // Realtime Message Deletion
        if (data.type === "message-deleted") {
          if (data.delete_type === "me") {
            setMessages((prev) => prev.filter((m) => m.id !== data.message_id));
          } else {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === data.message_id
                  ? {
                    ...m,
                    is_deleted_everyone: true,
                    msg_type: "deleted",
                    content: "This message was deleted",
                    file_url: null,
                    file_name: null,
                    file_size: null,
                  }
                  : m
              )
            );
          }
          return;
        }

        // WebRTC Signaling: Incoming Call
        if (data.type === "call-incoming") {
          setCallerInfo({
            id: data.caller_id,
            name: data.caller_name,
            avatar: data.caller_avatar,
          });
          setCallType(data.call_type || "audio");
          setCallState("incoming");
          startRingtone();
          return;
        }

        // WebRTC Signaling: Call Accepted
        if (data.type === "call-accepted") {
          stopRingtone();
          setCallState("connected");
          startCallTimer();

          // Create WebRTC Offer
          if (pc.current) {
            try {
              const offer = await pc.current.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: callTypeRef.current === "video",
              });
              await pc.current.setLocalDescription(offer);
              sendWsSignal({
                type: "webrtc-signal",
                target_id: data.receiver_id,
                signal: { type: "offer", sdp: offer },
              });
            } catch (err) {
              console.error("Failed to create offer:", err);
            }
          }
          return;
        }

        // WebRTC Signaling: Call Rejected
        if (data.type === "call-rejected") {
          stopRingtone();
          alert(data.reason || `${callerInfoRef.current?.name || "User"} declined the call.`);
          cleanupCall();
          return;
        }

        // WebRTC Signaling: Call Ended
        if (data.type === "call-ended") {
          cleanupCall();
          return;
        }

        // WebRTC Signaling: SDP / ICE Candidates
        if (data.type === "webrtc-signal") {
          handleWebRTCSignal(data);
          return;
        }

        // Chat Messages (Direct or Group)
        if (data.type === "direct" || data.type === "group") {
          // If direct chat is currently open and active with sender, mark seen immediately
          if (
            activeChatRef.current &&
            activeChatRef.current.type === "direct" &&
            data.sender_id === activeChatRef.current.id
          ) {
            sendWsSignal({ type: "mark-seen", target_id: data.sender_id });
          }

          // Optimistic UI reconciliation: replace matching optimistic message
          setMessages((prev) => {
            const optIdx = prev.findIndex(
              (m) =>
                m.is_optimistic &&
                m.sender_id === data.sender_id &&
                ((data.temp_id && m.id === data.temp_id) ||
                  (m.content === data.content && m.msg_type === data.msg_type))
            );
            if (optIdx !== -1) {
              const updated = [...prev];
              updated[optIdx] = data;
              return updated;
            }
            if (prev.some((m) => m.id === data.id)) return prev;
            return [...prev, data];
          });
          return;
        }

        // Fallback
        setMessages((prev) => [...prev, data]);
          } catch (err) {
            console.error("WS Parse error:", err);
          }
        };
      } catch (err) {
        console.warn("WebSocket initialization deferred:", err);
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(connectWebSocket, 3000);
      }
    };

    connectWebSocket();

    // Reconnect instantly when user returns to mobile browser tab or network reconnects
    const handleReengagement = () => {
      if (document.visibilityState === "visible") {
        if (!ws.current || ws.current.readyState === WebSocket.CLOSED || ws.current.readyState === WebSocket.CLOSING) {
          console.log("Tab foregrounded / focused: Reconnecting WebSocket...");
          connectWebSocket();
        } else if (ws.current.readyState === WebSocket.OPEN) {
          loadInitialData();
        }
      }
    };

    document.addEventListener("visibilitychange", handleReengagement);
    window.addEventListener("focus", handleReengagement);
    window.addEventListener("online", handleReengagement);

    return () => {
      document.removeEventListener("visibilitychange", handleReengagement);
      window.removeEventListener("focus", handleReengagement);
      window.removeEventListener("online", handleReengagement);
      clearTimeout(reconnectTimeoutRef.current);
      if (ws.current) {
        ws.current.close();
        ws.current = null;
      }
    };
  }, [token]);

  // Attach remote stream to audio/video elements when call connects
  useEffect(() => {
    if (callState === "connected" && remoteStream.current) {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream.current;
        remoteAudioRef.current.play().catch((e) => console.log("Audio play error:", e));
      }
      if (remoteVideoRef.current && callType === "video") {
        remoteVideoRef.current.srcObject = remoteStream.current;
        remoteVideoRef.current.play().catch((e) => console.log("Video play error:", e));
      }
    }
  }, [callState, callType]);

  // Fetch Chat History when Active Chat changes
  useEffect(() => {
    if (!activeChat || !token) return;
    setLoadingMessages(true);
    const fetchChatHistory = async () => {
      try {
        const endpoint =
          activeChat.type === "direct"
            ? `/api/messages/direct/${activeChat.id}?token=${token}`
            : `/api/messages/group/${activeChat.id}?token=${token}`;
        const res = await API.get(endpoint);
        setMessages(res.data);

        // If direct chat, notify server that messages were seen
        if (activeChat.type === "direct") {
          sendWsSignal({ type: "mark-seen", target_id: activeChat.id });
        }
      } catch (err) {
        console.error("Failed to load message history:", err);
      } finally {
        setLoadingMessages(false);
      }
    };
    fetchChatHistory();
  }, [activeChat, token]);

  // Auto-scroll messages container safely without moving the browser window
  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages, loadingMessages, activeChat]);

  // Ensure browser window itself never remains scrolled on mobile
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeChat]);

  // Helper to send WS signals
  const sendWsSignal = (payload) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(payload));
      return true;
    } else {
      console.warn("WebSocket not open. ReadyState:", ws.current?.readyState);
      if (payload.type === "call-request") {
        alert("Connecting to chat server... Please wait a moment and try calling again.");
        cleanupCall();
      }
      return false;
    }
  };

  // ---------------- WebRTC Calling Functions ----------------
  const initPeerConnection = (targetUserId) => {
    if (pc.current) {
      try { pc.current.close(); } catch (e) { }
    }

    const peer = new RTCPeerConnection(RTC_CONFIG);
    iceCandidatesQueue.current = [];

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        sendWsSignal({
          type: "webrtc-signal",
          target_id: targetUserId,
          signal: { type: "candidate", candidate: event.candidate },
        });
      }
    };

    peer.ontrack = (event) => {
      console.log("WebRTC received remote track:", event.track.kind);
      const stream = event.streams[0] || new MediaStream([event.track]);
      remoteStream.current = stream;

      // Always send audio to remoteAudioRef so user can HEAR!
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = stream;
        remoteAudioRef.current.play().catch((err) => console.log("Remote audio play error:", err));
      }
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
        remoteVideoRef.current.play().catch((err) => console.log("Remote video play error:", err));
      }
    };

    peer.onconnectionstatechange = () => {
      console.log("WebRTC Connection State:", peer.connectionState);
      if (peer.connectionState === "disconnected" || peer.connectionState === "failed") {
        cleanupCall();
      }
    };

    pc.current = peer;
    return peer;
  };

  const startLocalMedia = async (withVideo) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: withVideo ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } : false,
      });
      localStream.current = stream;
      if (localVideoRef.current && withVideo) {
        localVideoRef.current.srcObject = stream;
      }
      return stream;
    } catch (err) {
      console.error("Failed to access media devices:", err);
      alert("Microphone or camera access denied. Please grant browser permissions.");
      return null;
    }
  };

  // Initiate Call (Audio or Video)
  const handleStartCall = async (type) => {
    if (!activeChat || activeChat.type !== "direct") {
      alert("Calls are available for 1-to-1 chats.");
      return;
    }
    const withVideo = type === "video";
    setCallType(type);
    setCallerInfo({
      id: activeChat.id,
      name: activeChat.name,
      avatar: activeChat.profile_image,
    });
    setCallState("calling");

    const stream = await startLocalMedia(withVideo);
    if (!stream) {
      cleanupCall();
      return;
    }

    const peer = initPeerConnection(activeChat.id);
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));

    sendWsSignal({
      type: "call-request",
      call_type: type,
      target_id: activeChat.id,
    });
  };

  // Accept Incoming Call
  const handleAcceptCall = async () => {
    stopRingtone();
    setCallState("connected");
    startCallTimer();

    const withVideo = callType === "video";
    const stream = await startLocalMedia(withVideo);
    if (!stream) {
      cleanupCall();
      return;
    }

    const peer = initPeerConnection(callerInfo.id);
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));

    sendWsSignal({
      type: "call-accept",
      target_id: callerInfo.id,
    });
  };

  // Reject Incoming Call
  const handleRejectCall = () => {
    stopRingtone();
    if (callerInfo) {
      sendWsSignal({
        type: "call-reject",
        target_id: callerInfo.id,
      });
    }
    cleanupCall();
  };

  // End Active Call
  const handleEndCall = () => {
    if (callerInfo) {
      sendWsSignal({
        type: "call-end",
        target_id: callerInfo.id,
      });
    }
    cleanupCall();
  };

  const handleWebRTCSignal = async (data) => {
    const { signal, sender_id } = data;
    let peer = pc.current;

    if (!peer) {
      peer = initPeerConnection(sender_id);
      if (localStream.current) {
        localStream.current.getTracks().forEach((track) => peer.addTrack(track, localStream.current));
      }
    }

    try {
      if (signal.type === "offer") {
        await peer.setRemoteDescription(new RTCSessionDescription(signal.sdp));

        // Drain queued ICE candidates
        while (iceCandidatesQueue.current.length > 0) {
          const cand = iceCandidatesQueue.current.shift();
          try { await peer.addIceCandidate(cand); } catch (e) { }
        }

        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);

        sendWsSignal({
          type: "webrtc-signal",
          target_id: sender_id,
          signal: { type: "answer", sdp: answer },
        });
      } else if (signal.type === "answer") {
        await peer.setRemoteDescription(new RTCSessionDescription(signal.sdp));

        // Drain queued ICE candidates
        while (iceCandidatesQueue.current.length > 0) {
          const cand = iceCandidatesQueue.current.shift();
          try { await peer.addIceCandidate(cand); } catch (e) { }
        }
      } else if (signal.type === "candidate" && signal.candidate) {
        const candidate = new RTCIceCandidate(signal.candidate);
        if (peer.remoteDescription && peer.remoteDescription.type) {
          await peer.addIceCandidate(candidate);
        } else {
          iceCandidatesQueue.current.push(candidate);
        }
      }
    } catch (err) {
      console.error("WebRTC Signal handling error:", err);
    }
  };

  const toggleMute = () => {
    if (localStream.current) {
      localStream.current.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = () => {
    if (localStream.current) {
      localStream.current.getVideoTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsVideoDisabled(!isVideoDisabled);
    }
  };

  const cleanupCall = () => {
    stopRingtone();
    if (callTimerRef.current) clearInterval(callTimerRef.current);
    if (localStream.current) {
      localStream.current.getTracks().forEach((t) => t.stop());
      localStream.current = null;
    }
    if (remoteStream.current) {
      remoteStream.current.getTracks().forEach((t) => t.stop());
      remoteStream.current = null;
    }
    if (pc.current) {
      try { pc.current.close(); } catch (e) { }
      pc.current = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    setCallState("idle");
    setCallerInfo(null);
    setCallDuration(0);
    setIsMuted(false);
    setIsVideoDisabled(false);
  };

  const startCallTimer = () => {
    setCallDuration(0);
    if (callTimerRef.current) clearInterval(callTimerRef.current);
    callTimerRef.current = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);
  };

  const startRingtone = () => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();

      let toggle = false;
      const interval = setInterval(() => {
        toggle = !toggle;
        osc.frequency.setValueAtTime(toggle ? 480 : 440, audioCtx.currentTime);
      }, 600);

      ringtoneStopRef.current = () => {
        clearInterval(interval);
        try {
          osc.stop();
          audioCtx.close();
        } catch (e) { }
      };
    } catch (e) {
      ringtoneStopRef.current = () => { };
    }
  };

  const stopRingtone = () => {
    if (ringtoneStopRef.current) {
      ringtoneStopRef.current();
      ringtoneStopRef.current = null;
    }
  };

  const formatDuration = (seconds) => {
    const m = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  // ---------------- Message & Attachment Handlers ----------------
  // Staged File Selection (Previews image/document, DOES NOT send until Send button is clicked)
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file || !activeChat) return;

    const isImg = file.type.startsWith("image/");
    const previewUrl = isImg ? URL.createObjectURL(file) : null;
    const sizeFormatted =
      file.size > 1024 * 1024
        ? (file.size / (1024 * 1024)).toFixed(1) + " MB"
        : (file.size / 1024).toFixed(0) + " KB";

    setStagedFile({
      file,
      name: file.name,
      sizeFormatted,
      isImage: isImg,
      previewUrl,
    });

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeStagedFile = () => {
    if (stagedFile?.previewUrl) {
      URL.revokeObjectURL(stagedFile.previewUrl);
    }
    setStagedFile(null);
  };

  // Send Message (Text or Staged Attachment) with <0.4ms Optimistic UI Response
  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    if (!activeChat) return;

    // Case 1: Send Staged Attachment (Image / Document)
    if (stagedFile) {
      const fileToUpload = stagedFile.file;
      const isImg = stagedFile.isImage;
      const fileName = stagedFile.name;
      const fileSize = stagedFile.sizeFormatted;
      const previewUrl = stagedFile.previewUrl;
      const caption = textInput.trim();

      // Clear stage & text input instantly
      setStagedFile(null);
      setTextInput("");
      setShowEmojiPicker(false);

      const tempId = "temp_" + Date.now();
      const isTargetOnline =
        activeChat.type === "direct" && onlineUserIds.has(Number(activeChat.id));

      // Optimistic Message in UI (<0.2ms perceived latency)
      const optimisticMsg = {
        id: tempId,
        type: activeChat.type,
        sender_id: currentUser?.id,
        sender_name: currentUser?.username,
        sender_profile_image: currentUser?.profile_image,
        target_id: activeChat.type === "direct" ? activeChat.id : undefined,
        group_id: activeChat.type === "group" ? activeChat.id : undefined,
        content: caption || fileName,
        msg_type: isImg ? "image" : "document",
        file_url: previewUrl,
        file_name: fileName,
        file_size: fileSize,
        timestamp: new Date().toISOString(),
        status: isTargetOnline ? "delivered" : "sent",
        is_optimistic: true,
      };

      setMessages((prev) => [...prev, optimisticMsg]);
      setIsUploadingFile(true);

      const formData = new FormData();
      formData.append("file", fileToUpload);

      try {
        const res = await API.post("/api/upload-file", formData);
        const fileData = res.data;

        sendWsSignal({
          type: activeChat.type,
          target_id: activeChat.id,
          content: caption || fileData.file_name,
          msg_type: fileData.msg_type,
          file_url: fileData.url,
          file_name: fileData.file_name,
          file_size: fileData.file_size,
          temp_id: tempId,
        });
      } catch (err) {
        alert("Attachment upload failed. Please try again.");
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
      } finally {
        setIsUploadingFile(false);
      }
      return;
    }

    // Case 2: Send Text Message (Optimistic UI < 0.4ms)
    const textToSend = textInput.trim();
    if (!textToSend) return;

    const tempId = "temp_" + Date.now();
    const isTargetOnline =
      activeChat.type === "direct" && onlineUserIds.has(Number(activeChat.id));

    // Optimistic UI: Immediately render in DOM (<0.2ms)
    const optimisticMsg = {
      id: tempId,
      type: activeChat.type,
      sender_id: currentUser?.id,
      sender_name: currentUser?.username,
      sender_profile_image: currentUser?.profile_image,
      target_id: activeChat.type === "direct" ? activeChat.id : undefined,
      group_id: activeChat.type === "group" ? activeChat.id : undefined,
      content: textToSend,
      msg_type: "text",
      timestamp: new Date().toISOString(),
      status: isTargetOnline ? "delivered" : "sent",
      is_optimistic: true,
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setTextInput("");
    setShowEmojiPicker(false);

    // Broadcast over WebSocket
    sendWsSignal({
      type: activeChat.type,
      target_id: activeChat.id,
      content: textToSend,
      msg_type: "text",
      temp_id: tempId,
    });
  };

  // Delete Message (Everyone or For Me)
  const handleDeleteMessage = async (messageId, deleteType) => {
    try {
      sendWsSignal({
        type: "delete-message",
        message_id: messageId,
        delete_type: deleteType,
      });

      // Optimistic local update (<0.2ms)
      if (deleteType === "me") {
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                ...m,
                is_deleted_everyone: true,
                msg_type: "deleted",
                content: "This message was deleted",
                file_url: null,
                file_name: null,
                file_size: null,
              }
              : m
          )
        );
      }

      await API.post(`/api/messages/delete?token=${token}`, {
        message_id: messageId,
        delete_type: deleteType,
      });
    } catch (err) {
      console.error("Delete message error:", err);
    } finally {
      setDeleteModalMsg(null);
    }
  };

  // ---------------- Auth Handlers ----------------
  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthError("");
    setIsSubmitting(true);
    try {
      if (isLogin) {
        const res = await API.post("/api/login", { username, password });
        const accessToken = res.data.access_token;
        const userData = res.data.user || {
          id: JSON.parse(atob(accessToken.split(".")[1])).user_id,
          username: username,
        };

        localStorage.setItem("token", accessToken);
        localStorage.setItem("user", JSON.stringify(userData));
        setToken(accessToken);
        setCurrentUser(userData);
      } else {
        const formData = new FormData();
        formData.append("username", username);
        formData.append("password", password);
        if (profileImageFile) {
          formData.append("profile_image", profileImageFile);
        }

        await API.post("/api/register", formData);
        alert("Registration complete! Please log in.");
        setIsLogin(true);
        setProfileImageFile(null);
        setProfileImagePreview("");
      }
    } catch (err) {
      console.error("Auth error details:", err);
      if (err.response?.data?.detail) {
        setAuthError(err.response.data.detail);
      } else if (!err.response || err.message === "Network Error") {
        setAuthError(
          "Network Error: Cannot connect to backend server! Please verify your live API URL."
        );
      } else {
        setAuthError(err.message || "Authentication failed!");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = () => {
    localStorage.clear();
    setToken("");
    setCurrentUser(null);
    setActiveChat(null);
    setMessages([]);
    cleanupCall();
  };

  // Friend Request Actions
  const handleSendFriendRequest = async (e) => {
    e.preventDefault();
    if (!targetUserId) return;
    try {
      const res = await API.post(
        `/api/friend-request/send/${targetUserId}?token=${token}`
      );
      setFriendStatusMsg(res.data.message);
      setTargetUserId("");
      loadInitialData();
      setTimeout(() => setFriendStatusMsg(""), 4000);
    } catch (err) {
      setFriendStatusMsg(err.response?.data?.detail || "Request failed");
    }
  };

  const handleRespondRequest = async (requestId, action) => {
    try {
      await API.post(`/api/friend-request/respond?token=${token}`, {
        request_id: requestId,
        action,
      });
      loadInitialData();
    } catch (err) {
      alert("Failed to respond to request");
    }
  };

  // Group Create
  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return alert("Enter group name");
    try {
      await API.post(`/api/groups?token=${token}`, {
        name: newGroupName,
        member_ids: selectedGroupMembers,
      });
      setNewGroupName("");
      setSelectedGroupMembers([]);
      setShowGroupModal(false);
      loadInitialData();
    } catch (err) {
      alert("Failed to create group");
    }
  };

  // Filter messages for active chat
  const activeChatMessages = messages.filter((m) => {
    if (!activeChat) return false;
    if (activeChat.type === "direct") {
      return (
        m.type === "direct" &&
        ((m.sender_id === activeChat.id && m.target_id === currentUser?.id) ||
          (m.sender_id === currentUser?.id && m.target_id === activeChat.id))
      );
    }
    if (activeChat.type === "group") {
      return m.type === "group" && m.group_id === activeChat.id;
    }
    return false;
  });

  // Filter friends & groups by search
  const filteredFriends = friends.filter((f) =>
    f.username.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const filteredGroups = groups.filter((g) =>
    g.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // ---------------- UI RENDER (Instant 0ms Mount) ----------------


  // Protected Route: If not logged in, render Modern Glass Auth Screen
  if (!token) {
    return (
      <div style={styles.authContainer}>
        <div style={styles.authGlowOrb1} />
        <div style={styles.authGlowOrb2} />

        <div style={styles.authCard}>
          <div style={styles.authBrand}>
            <div style={styles.brandIconBox}>
              <Sparkles size={24} color="#6366f1" />
            </div>
            <h1 style={styles.brandTitle}>AuraChat</h1>
            <p style={styles.brandSubtitle}>
              Next-Gen Realtime Messenger & Audio/Video Calling
            </p>
          </div>

          <div style={styles.authTabs}>
            <button
              onClick={() => {
                setIsLogin(true);
                setAuthError("");
              }}
              style={{
                ...styles.authTabBtn,
                ...(isLogin ? styles.authTabActive : {}),
              }}
            >
              Sign In
            </button>
            <button
              onClick={() => {
                setIsLogin(false);
                setAuthError("");
              }}
              style={{
                ...styles.authTabBtn,
                ...(!isLogin ? styles.authTabActive : {}),
              }}
            >
              Create Account
            </button>
          </div>

          {authError && <div style={styles.errorBox}>{authError}</div>}

          <form onSubmit={handleAuth} style={styles.formContainer}>
            <div style={styles.inputGroup}>
              <label style={styles.inputLabel}>Username</label>
              <input
                style={styles.textInput}
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.inputLabel}>Password</label>
              <input
                style={styles.textInput}
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {!isLogin && (
              <div style={styles.inputGroup}>
                <label style={styles.inputLabel}>
                  Profile Picture (Optional)
                </label>
                <div style={styles.avatarPickerRow}>
                  {profileImagePreview ? (
                    <img
                      src={profileImagePreview}
                      alt="Preview"
                      style={styles.avatarPreview}
                    />
                  ) : (
                    <div style={styles.avatarPlaceholder}>
                      <User size={22} color="#94a3b8" />
                    </div>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      setProfileImageFile(file || null);
                      if (file) {
                        setProfileImagePreview(URL.createObjectURL(file));
                      } else {
                        setProfileImagePreview("");
                      }
                    }}
                    style={styles.fileInputStyle}
                  />
                </div>
              </div>
            )}

            <button
              style={styles.primaryGradientBtn}
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <span>Please wait...</span>
              ) : isLogin ? (
                <span>Sign In to AuraChat</span>
              ) : (
                <span>Create New Account</span>
              )}
            </button>
          </form>

          {/* Backend Server Connection Switcher (For Mobile & Custom Cloud Backends) */}
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.08)", textAlign: "center" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "#94a3b8" }}>
                Server: <strong style={{ color: currentServerUrl.includes("localhost") ? "#f59e0b" : "#10b981" }}>{currentServerUrl}</strong>
              </span>
              <button
                type="button"
                onClick={() => setShowServerConfig(!showServerConfig)}
                style={{
                  background: "rgba(255,255,255,0.08)",
                  border: "none",
                  borderRadius: 6,
                  padding: "3px 8px",
                  color: "#38bdf8",
                  fontSize: 11,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                {showServerConfig ? "Close" : "Change URL"}
              </button>
            </div>

            {showServerConfig && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8, textAlign: "left" }}>
                <p style={{ fontSize: 11, color: "#94a3b8", margin: 0 }}>
                  Enter live backend URL (e.g. Render, Railway, or local IP):
                </p>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type="text"
                    value={customServerInput}
                    onChange={(e) => setCustomServerInput(e.target.value)}
                    placeholder="https://your-backend.onrender.com"
                    style={{
                      ...styles.textInput,
                      padding: "8px 10px",
                      fontSize: 12,
                      flex: 1,
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleSaveServerUrl}
                    style={{
                      background: "#6366f1",
                      color: "#fff",
                      border: "none",
                      borderRadius: 8,
                      padding: "8px 14px",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Main Dashboard
  return (
    <div
      className={isMobile ? (activeChat ? "app-root has-active-chat" : "app-root has-no-chat") : "app-root"}
      style={styles.mainLayout}
    >
      {/* 
        CRITICAL: Persistent Remote Audio Element 
        This is always mounted in the DOM to ensure you CAN ALWAYS HEAR THE REMOTE USER'S VOICE!
      */}
      <audio
        ref={remoteAudioRef}
        autoPlay
        playsInline
        controls={false}
        style={{ position: "fixed", bottom: -100, opacity: 0, pointerEvents: "none" }}
      />

      {/* ---------------- SIDEBAR ---------------- */}
      <div
        className={
          isMobile && activeChat
            ? "app-sidebar app-sidebar-mobile-hidden"
            : isMobile
              ? "app-sidebar app-sidebar-mobile-full"
              : "app-sidebar"
        }
        style={{
          ...styles.sidebar,
          display: isMobile && activeChat ? "none" : "flex",
          width: isMobile ? "100%" : "360px",
          minWidth: isMobile ? "100%" : "340px",
          maxWidth: isMobile ? "100%" : "380px",
          flexShrink: isMobile ? 1 : 0,
        }}
      >
        {/* User Profile Bar */}
        <div style={styles.sidebarHeader}>
          <div style={styles.userProfileInfo}>
            <div style={styles.avatarWrapper}>
              {currentUser?.profile_image ? (
                <img
                  src={currentUser.profile_image}
                  alt={currentUser.username}
                  style={styles.userAvatarImg}
                />
              ) : (
                <div style={styles.userAvatarFallback}>
                  <User size={20} color="#cbd5e1" />
                </div>
              )}
              <div style={styles.onlineStatusBadge} />
            </div>
            <div>
              <div style={styles.profileName}>{currentUser?.username}</div>
              <div style={styles.profileBadge}>ID: #{currentUser?.id}</div>
            </div>
          </div>

          <button
            onClick={handleLogout}
            style={styles.iconActionBtn}
            title="Log Out"
          >
            <LogOut size={18} color="#ef4444" />
          </button>
        </div>

        {/* Search & Add Friend */}
        <div style={styles.searchSection}>
          <div style={styles.searchBar}>
            <Search size={16} color="#64748b" />
            <input
              style={styles.searchInput}
              placeholder="Search conversations..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Add Friend Row */}
          <form
            onSubmit={handleSendFriendRequest}
            style={styles.addFriendForm}
          >
            <input
              type="number"
              placeholder="Enter User ID to add"
              value={targetUserId}
              onChange={(e) => setTargetUserId(e.target.value)}
              style={styles.addFriendInput}
            />
            <button type="submit" style={styles.addFriendBtn}>
              <Plus size={16} /> Add
            </button>
          </form>
          {friendStatusMsg && (
            <div style={styles.statusToast}>{friendStatusMsg}</div>
          )}
        </div>

        {/* Pending Requests Section */}
        {pendingRequests.length > 0 && (
          <div style={styles.pendingSection}>
            <div style={styles.sectionHeaderTitle}>
              PENDING INVITATIONS ({pendingRequests.length})
            </div>
            {pendingRequests.map((req) => (
              <div key={req.request_id} style={styles.pendingCard}>
                <div style={styles.pendingUserRow}>
                  {req.sender_profile_image ? (
                    <img
                      src={req.sender_profile_image}
                      alt={req.sender_username}
                      style={styles.smallAvatar}
                    />
                  ) : (
                    <div style={styles.smallAvatarFallback}>
                      <User size={14} color="#94a3b8" />
                    </div>
                  )}
                  <div>
                    <div style={styles.pendingName}>{req.sender_username}</div>
                    <div style={styles.pendingSub}>User #{req.sender_id}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => handleRespondRequest(req.request_id, "accept")}
                    style={styles.acceptMiniBtn}
                    title="Accept"
                  >
                    <Check size={14} /> Accept
                  </button>
                  <button
                    onClick={() => handleRespondRequest(req.request_id, "reject")}
                    style={styles.rejectMiniBtn}
                    title="Reject"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Contacts & Groups Navigation List */}
        <div style={styles.listContainer}>
          {/* Direct Messages */}
          <div style={styles.listSectionHeader}>
            <span style={styles.sectionHeaderTitle}>DIRECT MESSAGES</span>
          </div>

          {loadingContacts ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "6px 0" }}>
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={`skel-contact-${i}`} style={styles.skeletonContactRow}>
                  <div className="skeleton-box skeleton-avatar" style={{ width: 44, height: 44 }} />
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div className="skeleton-box skeleton-text" style={{ width: "65%", height: 13 }} />
                    <div className="skeleton-box skeleton-text" style={{ width: "38%", height: 10 }} />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredFriends.length === 0 ? (
            <div style={styles.emptyListText}>No direct contacts found</div>
          ) : (
            filteredFriends.map((f) => {
              const isActive =
                activeChat?.type === "direct" && activeChat.id === f.id;
              const isOnline = onlineUserIds.has(Number(f.id));
              return (
                <div
                  key={`friend-${f.id}`}
                  onClick={() =>
                    setActiveChat({
                      type: "direct",
                      id: f.id,
                      name: f.username,
                      profile_image: f.profile_image,
                    })
                  }
                  style={{
                    ...styles.chatListItem,
                    ...(isActive ? styles.chatListItemActive : {}),
                  }}
                >
                  <div style={styles.avatarWrapper}>
                    {f.profile_image ? (
                      <img
                        src={f.profile_image}
                        alt={f.username}
                        style={styles.chatListAvatar}
                      />
                    ) : (
                      <div style={styles.chatListAvatarFallback}>
                        <User size={18} color="#94a3b8" />
                      </div>
                    )}
                    <div
                      style={{
                        ...styles.onlineDot,
                        background: isOnline ? "#10b981" : "#64748b",
                        boxShadow: isOnline ? "0 0 8px rgba(16, 185, 129, 0.65)" : "none",
                      }}
                    />
                  </div>
                  <div style={styles.chatListInfo}>
                    <div style={styles.chatListTitle}>{f.username}</div>
                    <div
                      style={{
                        ...styles.chatListSub,
                        color: isOnline ? "#34d399" : "#64748b",
                      }}
                    >
                      {isOnline ? "Active now" : "Offline"} • ID #{f.id}
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {/* Groups */}
          <div
            style={{
              ...styles.listSectionHeader,
              marginTop: 20,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={styles.sectionHeaderTitle}>GROUPS</span>
            <button
              onClick={() => setShowGroupModal(true)}
              style={styles.newGroupBtn}
            >
              <Plus size={14} /> New Group
            </button>
          </div>

          {loadingContacts ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "6px 0" }}>
              {[1, 2].map((i) => (
                <div key={`skel-grp-${i}`} style={styles.skeletonContactRow}>
                  <div className="skeleton-box skeleton-avatar" style={{ width: 44, height: 44 }} />
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div className="skeleton-box skeleton-text" style={{ width: "55%", height: 13 }} />
                    <div className="skeleton-box skeleton-text" style={{ width: "35%", height: 10 }} />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredGroups.length === 0 ? (
            <div style={styles.emptyListText}>No joined groups yet</div>
          ) : (
            filteredGroups.map((g) => {
              const isActive =
                activeChat?.type === "group" && activeChat.id === g.id;
              return (
                <div
                  key={`group-${g.id}`}
                  onClick={() =>
                    setActiveChat({
                      type: "group",
                      id: g.id,
                      name: g.name,
                    })
                  }
                  style={{
                    ...styles.chatListItem,
                    ...(isActive ? styles.chatListItemActive : {}),
                  }}
                >
                  <div style={styles.groupAvatarBox}>
                    <Users size={18} color="#38bdf8" />
                  </div>
                  <div style={styles.chatListInfo}>
                    <div style={styles.chatListTitle}>{g.name}</div>
                    <div style={styles.chatListSub}>Group Channel</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ---------------- CHAT WINDOW AREA ---------------- */}
      <div
        className={
          isMobile && !activeChat
            ? "app-chat-window app-chat-mobile-hidden"
            : isMobile
              ? "app-chat-window app-chat-mobile-full"
              : "app-chat-window"
        }
        style={{
          ...styles.chatWindow,
          display: isMobile && !activeChat ? "none" : "flex",
          width: isMobile ? "100%" : "auto",
        }}
      >
        {activeChat ? (
          <>
            {/* Chat Top Header */}
            <div style={styles.chatHeader}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 }}>
                {/* Mobile Back Button */}
                {isMobile && (
                  <button
                    onClick={() => setActiveChat(null)}
                    style={styles.backBtn}
                    title="Back to Contacts"
                  >
                    <ArrowLeft size={18} />
                  </button>
                )}

                <div style={styles.headerAvatarBox}>
                  {activeChat.profile_image ? (
                    <img
                      src={activeChat.profile_image}
                      alt={activeChat.name}
                      style={styles.chatHeaderAvatar}
                    />
                  ) : activeChat.type === "group" ? (
                    <div style={styles.groupAvatarBox}>
                      <Users size={20} color="#38bdf8" />
                    </div>
                  ) : (
                    <div style={styles.chatListAvatarFallback}>
                      <User size={20} color="#94a3b8" />
                    </div>
                  )}
                </div>

                <div>
                  <h2 style={styles.chatHeaderTitle}>{activeChat.name}</h2>
                  <div style={styles.chatHeaderSub}>
                    {activeChat.type === "direct" ? (
                      (() => {
                        const isChatOnline = onlineUserIds.has(Number(activeChat.id));
                        return (
                          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: "50%",
                                background: isChatOnline ? "#10b981" : "#64748b",
                                display: "inline-block",
                                boxShadow: isChatOnline ? "0 0 8px rgba(16, 185, 129, 0.7)" : "none",
                              }}
                            />
                            {isChatOnline ? "Active now" : "Offline"}
                          </span>
                        );
                      })()
                    ) : (
                      "Group Conversation"
                    )}
                  </div>
                </div>
              </div>

              {/* Header Right Actions: Audio/Video Call + Close Chat Button */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {activeChat.type === "direct" && (
                  <>
                    <button
                      onClick={() => handleStartCall("audio")}
                      style={styles.callActionBtn}
                      title="Audio Call"
                    >
                      <Phone size={18} color="#38bdf8" />
                    </button>
                    <button
                      onClick={() => handleStartCall("video")}
                      style={styles.callActionBtn}
                      title="Video Call"
                    >
                      <Video size={18} color="#818cf8" />
                    </button>
                  </>
                )}

                {/* Prominent Chat Close Button (works on desktop & mobile) */}
                <button
                  onClick={() => setActiveChat(null)}
                  style={styles.closeChatHeaderBtn}
                  title="Close Chat (Esc)"
                >
                  <X size={18} color="#f87171" />
                  {!isMobile && (
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#f87171" }}>
                      Close
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Messages Scroll Box with Skeleton Support */}
            <div ref={messagesContainerRef} style={styles.messagesContainer}>
              {loadingMessages ? (
                <div style={styles.skeletonChatContainer}>
                  <div style={{ alignSelf: "flex-start", width: "45%", height: 50, borderRadius: 16 }} className="skeleton-box" />
                  <div style={{ alignSelf: "flex-end", width: "55%", height: 60, borderRadius: 16 }} className="skeleton-box" />
                  <div style={{ alignSelf: "flex-start", width: "38%", height: 44, borderRadius: 16 }} className="skeleton-box" />
                  <div style={{ alignSelf: "flex-end", width: "62%", height: 68, borderRadius: 16 }} className="skeleton-box" />
                  <div style={{ alignSelf: "flex-start", width: "50%", height: 52, borderRadius: 16 }} className="skeleton-box" />
                </div>
              ) : (
                activeChatMessages.map((msg, idx) => {
                  const isMe = msg.sender_id === currentUser?.id;
                  const isDeleted = msg.is_deleted_everyone || msg.msg_type === "deleted";

                  return (
                    <div
                      key={msg.id || idx}
                      style={{
                        ...styles.messageRow,
                        justifyContent: isMe ? "flex-end" : "flex-start",
                      }}
                    >
                      {!isMe && (
                        <div style={styles.msgAvatarWrapper}>
                          {msg.sender_profile_image ? (
                            <img
                              src={msg.sender_profile_image}
                              alt={msg.sender_name}
                              style={styles.msgAvatar}
                            />
                          ) : (
                            <div style={styles.msgAvatarFallback}>
                              <User size={14} color="#94a3b8" />
                            </div>
                          )}
                        </div>
                      )}

                      <div
                        style={{
                          ...styles.messageBubble,
                          ...(isMe
                            ? styles.messageBubbleMe
                            : styles.messageBubbleOther),
                        }}
                      >
                        {!isMe && (
                          <div style={styles.msgSenderName}>
                            {msg.sender_name}
                          </div>
                        )}

                        {/* Deleted Message Notice */}
                        {isDeleted ? (
                          <div style={styles.deletedMsgBox}>
                            <Ban size={14} color="#94a3b8" />
                            <span style={{ fontStyle: "italic", color: "#94a3b8" }}>
                              This message was deleted
                            </span>
                          </div>
                        ) : msg.msg_type === "image" && msg.file_url ? (
                          /* Image Message */
                          <div style={styles.msgImageContainer}>
                            <img
                              src={getFileUrl(msg.file_url)}
                              alt="Attachment"
                              onClick={() => setLightboxImage(getFileUrl(msg.file_url))}
                              style={styles.msgImagePreview}
                            />
                            {msg.content && msg.content !== msg.file_name && (
                              <div style={styles.captionText}>{msg.content}</div>
                            )}
                          </div>
                        ) : msg.msg_type === "document" && msg.file_url ? (
                          /* Document / PDF Message */
                          <div style={styles.documentCard}>
                            <div style={styles.docIconBox}>
                              <FileText size={22} color="#38bdf8" />
                            </div>
                            <div style={styles.docInfo}>
                              <div style={styles.docName}>{msg.file_name || "Document"}</div>
                              <div style={styles.docSize}>{msg.file_size || "File"}</div>
                            </div>
                            <a
                              href={getFileUrl(msg.file_url)}
                              target="_blank"
                              rel="noopener noreferrer"
                              download
                              style={styles.docDownloadBtn}
                              title="Download / Open"
                            >
                              <Download size={16} />
                            </a>
                          </div>
                        ) : (
                          /* Standard Text Message */
                          <div style={styles.msgText}>{msg.content}</div>
                        )}

                        {/* Bottom Row: Timestamp, Status Receipts (Sent / Delivered / Seen), & Delete */}
                        <div style={styles.msgBottomRow}>
                          <span style={styles.msgTimestamp}>
                            {msg.timestamp
                              ? new Date(msg.timestamp).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                              : ""}
                          </span>

                          {/* Outgoing Message Status: Sent (✓) | Delivered (✓✓) | Seen (✓✓ cyan) */}
                          {isMe && !isDeleted && (
                            <span style={styles.msgStatusBadge} title={msg.status}>
                              {msg.status === "seen" ? (
                                <span style={{ color: "#38bdf8", display: "inline-flex", alignItems: "center", gap: 3, fontWeight: 600 }}>
                                  <CheckCheck size={13} /> Seen
                                </span>
                              ) : msg.status === "delivered" ? (
                                <span style={{ color: "#cbd5e1", display: "inline-flex", alignItems: "center", gap: 3 }}>
                                  <CheckCheck size={13} /> Delivered
                                </span>
                              ) : (
                                <span style={{ color: "#94a3b8", display: "inline-flex", alignItems: "center", gap: 3 }}>
                                  <Check size={13} /> Sent
                                </span>
                              )}
                            </span>
                          )}

                          {/* Delete Message Action Trigger */}
                          {!isDeleted && (
                            <button
                              onClick={() => setDeleteModalMsg(msg)}
                              style={styles.msgDeleteBtn}
                              title="Delete message"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Emoji Picker Popover */}
            {showEmojiPicker && (
              <div style={styles.emojiPickerContainer}>
                <div style={styles.emojiGrid}>
                  {EMOJI_LIST.map((emo) => (
                    <button
                      key={emo}
                      onClick={() => setTextInput((prev) => prev + emo)}
                      style={styles.emojiBtn}
                    >
                      {emo}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Staged File Preview Card (Image / PDF Selected, NOT sent until Send button clicked) */}
            {stagedFile && (
              <div style={styles.stagedFileBar}>
                <div style={styles.stagedFileInfo}>
                  {stagedFile.isImage && stagedFile.previewUrl ? (
                    <img
                      src={stagedFile.previewUrl}
                      alt="Staged Preview"
                      style={styles.stagedImageThumb}
                    />
                  ) : (
                    <div style={styles.stagedDocIcon}>
                      <FileText size={22} color="#38bdf8" />
                    </div>
                  )}
                  <div style={{ overflow: "hidden" }}>
                    <div style={styles.stagedFileName}>{stagedFile.name}</div>
                    <div style={styles.stagedFileSize}>
                      {stagedFile.sizeFormatted} • Click Send to send
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={removeStagedFile}
                  style={styles.removeStagedBtn}
                  title="Remove attachment"
                >
                  <X size={16} />
                </button>
              </div>
            )}

            {/* Input Bar Area */}
            <form onSubmit={handleSendMessage} style={styles.inputArea}>
              {/* Document / Image Attachment Picker (Stages file without immediately sending) */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                style={{ display: "none" }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploadingFile}
                style={styles.attachBtn}
                title="Select Image or Document"
              >
                {isUploadingFile ? (
                  <span style={{ fontSize: 11, color: "#38bdf8" }}>...</span>
                ) : (
                  <Paperclip size={20} color="#94a3b8" />
                )}
              </button>

              {/* Emoji Button */}
              <button
                type="button"
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                style={styles.emojiToggleBtn}
                title="Pick Emoji"
              >
                <Smile
                  size={20}
                  color={showEmojiPicker ? "#6366f1" : "#94a3b8"}
                />
              </button>

              {/* Main Message Input */}
              <input
                style={styles.chatInputField}
                placeholder={stagedFile ? "Add a caption... (optional)" : "Write a message... (supports emojis & files)"}
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
              />

              {/* Send Button */}
              <button
                type="submit"
                style={styles.sendSubmitBtn}
                title={stagedFile ? "Send file attachment" : "Send message"}
              >
                <Send size={18} color="#ffffff" />
              </button>
            </form>
          </>
        ) : (
          /* Empty Chat Selected Placeholder */
          <div style={styles.noChatPlaceholder}>
            <div style={styles.noChatIconBox}>
              <Sparkles size={36} color="#6366f1" />
            </div>
            <h3 style={styles.noChatTitle}>Select a Conversation</h3>
            <p style={styles.noChatSubtitle}>
              Connect with friends, start an audio/video call, or share documents and photos.
            </p>
          </div>
        )}
      </div>

      {/* ---------------- INCOMING CALL MODAL ---------------- */}
      {callState === "incoming" && callerInfo && (
        <div style={styles.callModalBackdrop}>
          <div style={styles.incomingCallCard}>
            <div style={styles.callAvatarRing}>
              {callerInfo.avatar ? (
                <img
                  src={callerInfo.avatar}
                  alt={callerInfo.name}
                  style={styles.callModalAvatar}
                />
              ) : (
                <div style={styles.callModalAvatarFallback}>
                  <User size={40} color="#cbd5e1" />
                </div>
              )}
            </div>

            <h3 style={styles.callModalTitle}>{callerInfo.name}</h3>
            <p style={styles.callModalSubtitle}>
              Incoming {callType === "video" ? "Video" : "Audio"} Call...
            </p>

            <div style={styles.callActionsRow}>
              <button
                onClick={handleRejectCall}
                style={styles.declineCallBtn}
                title="Decline"
              >
                <PhoneOff size={22} color="#ffffff" />
              </button>
              <button
                onClick={handleAcceptCall}
                style={styles.acceptCallBtn}
                title="Accept"
              >
                {callType === "video" ? (
                  <Video size={22} color="#ffffff" />
                ) : (
                  <Phone size={22} color="#ffffff" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- ACTIVE CALL / CALLING OVERLAY ---------------- */}
      {(callState === "calling" || callState === "connected") && (
        <div style={styles.activeCallOverlay}>
          {/* Remote Media View */}
          <div style={styles.remoteMediaContainer}>
            {callType === "video" ? (
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                style={styles.remoteVideoElement}
              />
            ) : null}

            {/* Audio Call Animated Avatar or Waiting Screen */}
            {(callType === "audio" || callState === "calling") && (
              <div style={styles.audioCallCenterBox}>
                <div style={styles.audioWaveRing}>
                  {callerInfo?.avatar ? (
                    <img
                      src={callerInfo.avatar}
                      alt="Caller"
                      style={styles.activeCallBigAvatar}
                    />
                  ) : (
                    <div style={styles.activeCallBigAvatarFallback}>
                      <User size={50} color="#94a3b8" />
                    </div>
                  )}
                </div>
                <h2 style={{ marginTop: 18, fontSize: 22, color: "#fff" }}>
                  {callerInfo?.name}
                </h2>
                <div style={{ color: "#38bdf8", marginTop: 6, fontSize: 14 }}>
                  {callState === "calling"
                    ? "Calling..."
                    : `In Call • ${formatDuration(callDuration)}`}
                </div>
              </div>
            )}
          </div>

          {/* Local PiP Video (For Video Calls) */}
          {callType === "video" && (
            <div style={styles.pipVideoBox}>
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                style={styles.pipVideoElement}
              />
            </div>
          )}

          {/* Floating Call Controls Bar */}
          <div style={styles.callControlsFloatingBar}>
            <button
              onClick={toggleMute}
              style={{
                ...styles.callControlCircle,
                background: isMuted ? "#ef4444" : "rgba(255,255,255,0.15)",
              }}
              title={isMuted ? "Unmute Mic" : "Mute Mic"}
            >
              {isMuted ? <MicOff size={22} /> : <Mic size={22} />}
            </button>

            {callType === "video" && (
              <button
                onClick={toggleVideo}
                style={{
                  ...styles.callControlCircle,
                  background: isVideoDisabled ? "#ef4444" : "rgba(255,255,255,0.15)",
                }}
                title={isVideoDisabled ? "Turn Video On" : "Turn Video Off"}
              >
                {isVideoDisabled ? <VideoOff size={22} /> : <Video size={22} />}
              </button>
            )}

            <button
              onClick={handleEndCall}
              style={styles.hangupCircleBtn}
              title="End Call"
            >
              <PhoneOff size={24} color="#ffffff" />
            </button>
          </div>
        </div>
      )}

      {/* ---------------- LIGHTBOX IMAGE PREVIEW ---------------- */}
      {lightboxImage && (
        <div
          onClick={() => setLightboxImage(null)}
          style={styles.lightboxBackdrop}
        >
          <img
            src={lightboxImage}
            alt="Preview"
            style={styles.lightboxImage}
          />
          <button
            onClick={() => setLightboxImage(null)}
            style={styles.lightboxCloseBtn}
          >
            <X size={24} />
          </button>
        </div>
      )}

      {/* ---------------- CREATE GROUP MODAL ---------------- */}
      {showGroupModal && (
        <div style={styles.modalBackdrop}>
          <div style={styles.modalCard}>
            <div style={styles.modalHeaderRow}>
              <h3 style={styles.modalTitle}>Create New Group</h3>
              <button
                onClick={() => setShowGroupModal(false)}
                style={styles.modalCloseBtn}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ marginTop: 14 }}>
              <label style={styles.inputLabel}>Group Name</label>
              <input
                style={styles.textInput}
                placeholder="e.g. Project Alpha"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
              />
            </div>

            <div style={{ marginTop: 14 }}>
              <label style={styles.inputLabel}>Select Group Members</label>
              <div style={styles.groupMembersList}>
                {friends.length === 0 ? (
                  <div style={styles.emptyListText}>
                    No friends available to add
                  </div>
                ) : (
                  friends.map((f) => (
                    <label key={f.id} style={styles.groupCheckboxRow}>
                      <input
                        type="checkbox"
                        checked={selectedGroupMembers.includes(f.id)}
                        onChange={() =>
                          setSelectedGroupMembers((prev) =>
                            prev.includes(f.id)
                              ? prev.filter((id) => id !== f.id)
                              : [...prev, f.id]
                          )
                        }
                      />
                      <span style={{ marginLeft: 8, color: "#e2e8f0" }}>
                        {f.username} (ID: #{f.id})
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <div style={styles.modalFooterRow}>
              <button
                onClick={() => setShowGroupModal(false)}
                style={styles.cancelBtn}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateGroup}
                style={styles.primaryGradientBtn}
              >
                Create Channel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- DELETE MESSAGE MODAL ---------------- */}
      {deleteModalMsg && (
        <div style={styles.modalBackdrop} onClick={() => setDeleteModalMsg(null)}>
          <div style={styles.deleteModalCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.deleteModalHeader}>
              <div style={styles.deleteModalIcon}>
                <Trash2 size={22} color="#ef4444" />
              </div>
              <div>
                <h3 style={styles.modalTitle}>Delete Message?</h3>
                <p style={styles.deleteModalSubtitle}>
                  Choose how you want to delete this message.
                </p>
              </div>
            </div>

            <div style={styles.deleteOptionsCol}>
              {deleteModalMsg.sender_id === currentUser?.id && (
                <button
                  onClick={() => handleDeleteMessage(deleteModalMsg.id, "everyone")}
                  style={styles.deleteEveryoneBtn}
                >
                  <div style={{ fontWeight: 700, fontSize: 14 }}>Delete for everyone</div>
                  <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
                    Deletes this message for both participants in this chat
                  </div>
                </button>
              )}

              <button
                onClick={() => handleDeleteMessage(deleteModalMsg.id, "me")}
                style={styles.deleteForMeBtn}
              >
                <div style={{ fontWeight: 700, fontSize: 14 }}>Delete for me</div>
                <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
                  Removes this message only from your view
                </div>
              </button>
            </div>

            <div style={{ ...styles.modalFooterRow, marginTop: 18 }}>
              <button
                onClick={() => setDeleteModalMsg(null)}
                style={styles.cancelBtn}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- STYLES SYSTEM ----------------
const styles = {
  // Splash Loading
  authSplash: {
    height: "100vh",
    width: "100vw",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    background: "#090d16",
  },
  spinner: {
    width: 38,
    height: 38,
    border: "3px solid rgba(255,255,255,0.1)",
    borderTop: "3px solid #6366f1",
    borderRadius: "50%",
    animation: "ringRipple 1s infinite linear",
  },

  // Auth Layout
  authContainer: {
    position: "relative",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    minHeight: "100vh",
    width: "100vw",
    background: "radial-gradient(ellipse at top, #161c30 0%, #090d16 100%)",
    padding: 20,
    overflow: "hidden",
  },
  authGlowOrb1: {
    position: "absolute",
    top: "10%",
    left: "15%",
    width: 320,
    height: 320,
    borderRadius: "50%",
    background: "rgba(99, 102, 241, 0.18)",
    filter: "blur(90px)",
    pointerEvents: "none",
  },
  authGlowOrb2: {
    position: "absolute",
    bottom: "10%",
    right: "15%",
    width: 360,
    height: 360,
    borderRadius: "50%",
    background: "rgba(6, 182, 212, 0.14)",
    filter: "blur(100px)",
    pointerEvents: "none",
  },
  authCard: {
    position: "relative",
    zIndex: 10,
    background: "rgba(16, 21, 36, 0.8)",
    backdropFilter: "blur(24px)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: 20,
    padding: 36,
    width: "100%",
    maxWidth: 420,
    boxShadow: "0 20px 40px rgba(0,0,0,0.45)",
  },
  authBrand: { textAlign: "center", marginBottom: 24 },
  brandIconBox: {
    display: "inline-flex",
    padding: 12,
    borderRadius: 16,
    background: "rgba(99, 102, 241, 0.12)",
    marginBottom: 10,
  },
  brandTitle: {
    fontSize: 26,
    fontWeight: 800,
    color: "#f8fafc",
    letterSpacing: -0.5,
  },
  brandSubtitle: { fontSize: 13, color: "#94a3b8", marginTop: 4 },
  authTabs: {
    display: "flex",
    background: "rgba(255, 255, 255, 0.04)",
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
  },
  authTabBtn: {
    flex: 1,
    padding: "8px 12px",
    background: "none",
    border: "none",
    color: "#94a3b8",
    fontWeight: 600,
    fontSize: 13,
    borderRadius: 8,
    cursor: "pointer",
    transition: "all 0.2s",
  },
  authTabActive: {
    background: "#6366f1",
    color: "#ffffff",
    boxShadow: "0 2px 8px rgba(99, 102, 241, 0.4)",
  },
  formContainer: { display: "flex", flexDirection: "column", gap: 14 },
  inputGroup: { display: "flex", flexDirection: "column", gap: 6 },
  inputLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: "#cbd5e1",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  textInput: {
    width: "100%",
    padding: "11px 14px",
    background: "rgba(255, 255, 255, 0.04)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: 10,
    color: "#f8fafc",
    outline: "none",
    fontSize: 14,
    transition: "border 0.2s",
  },
  avatarPickerRow: { display: "flex", alignItems: "center", gap: 12 },
  avatarPreview: {
    width: 48,
    height: 48,
    borderRadius: "50%",
    objectFit: "cover",
    border: "2px solid #6366f1",
  },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: "50%",
    background: "rgba(255,255,255,0.06)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px dashed rgba(255,255,255,0.18)",
  },
  fileInputStyle: { fontSize: 12, color: "#94a3b8" },
  primaryGradientBtn: {
    marginTop: 8,
    padding: "12px 18px",
    background: "linear-gradient(135deg, #6366f1 0%, #3b82f6 100%)",
    color: "#ffffff",
    border: "none",
    borderRadius: 10,
    fontWeight: 700,
    fontSize: 14,
    cursor: "pointer",
    boxShadow: "0 4px 14px rgba(99, 102, 241, 0.35)",
    transition: "transform 0.15s, opacity 0.15s",
  },
  errorBox: {
    background: "rgba(239, 68, 68, 0.15)",
    border: "1px solid rgba(239, 68, 68, 0.3)",
    color: "#fca5a5",
    padding: 10,
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 12,
  },

  // Main Dashboard
  mainLayout: {
    display: "flex",
    height: "100%",
    maxHeight: "100%",
    width: "100%",
    maxWidth: "100vw",
    background: "#090d16",
    overflow: "hidden",
    position: "relative",
  },

  // Sidebar
  sidebar: {
    background: "#101524",
    borderRight: "1px solid rgba(255, 255, 255, 0.07)",
    display: "flex",
    flexDirection: "column",
    height: "100%",
    maxHeight: "100%",
    overflow: "hidden",
    position: "relative",
  },
  sidebarHeader: {
    padding: "16px 18px",
    borderBottom: "1px solid rgba(255, 255, 255, 0.07)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexShrink: 0,
    position: "sticky",
    top: 0,
    zIndex: 40,
    background: "#101524",
  },
  userProfileInfo: { display: "flex", alignItems: "center", gap: 12 },
  avatarWrapper: { position: "relative" },
  userAvatarImg: {
    width: 42,
    height: 42,
    borderRadius: "50%",
    objectFit: "cover",
    border: "1.5px solid rgba(99, 102, 241, 0.6)",
  },
  userAvatarFallback: {
    width: 42,
    height: 42,
    borderRadius: "50%",
    background: "#1e293b",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  onlineStatusBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 11,
    height: 11,
    borderRadius: "50%",
    background: "#10b981",
    border: "2px solid #101524",
  },
  profileName: { fontSize: 15, fontWeight: 700, color: "#f8fafc" },
  profileBadge: { fontSize: 11, color: "#64748b", marginTop: 2 },
  iconActionBtn: {
    background: "rgba(239, 68, 68, 0.1)",
    border: "none",
    borderRadius: 8,
    padding: 8,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  searchSection: {
    padding: "12px 16px",
    borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
  },
  searchBar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "rgba(255, 255, 255, 0.03)",
    border: "1px solid rgba(255, 255, 255, 0.07)",
    borderRadius: 10,
    padding: "8px 12px",
  },
  searchInput: {
    background: "none",
    border: "none",
    outline: "none",
    color: "#f8fafc",
    fontSize: 13,
    flex: 1,
  },
  addFriendForm: { display: "flex", gap: 6, marginTop: 10 },
  addFriendInput: {
    flex: 1,
    background: "rgba(255, 255, 255, 0.03)",
    border: "1px solid rgba(255, 255, 255, 0.07)",
    borderRadius: 8,
    padding: "6px 10px",
    color: "#f8fafc",
    fontSize: 12,
    outline: "none",
  },
  addFriendBtn: {
    background: "#6366f1",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  statusToast: {
    fontSize: 11,
    color: "#38bdf8",
    marginTop: 6,
    padding: "4px 8px",
    background: "rgba(56, 189, 248, 0.1)",
    borderRadius: 6,
  },

  pendingSection: {
    padding: "12px 16px",
    background: "rgba(99, 102, 241, 0.04)",
    borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
  },
  sectionHeaderTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: "#64748b",
    letterSpacing: 0.6,
  },
  pendingCard: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "rgba(255, 255, 255, 0.04)",
    padding: "8px 10px",
    borderRadius: 8,
    marginTop: 8,
    border: "1px solid rgba(255, 255, 255, 0.06)",
  },
  pendingUserRow: { display: "flex", alignItems: "center", gap: 8 },
  smallAvatar: { width: 28, height: 28, borderRadius: "50%", objectFit: "cover" },
  smallAvatarFallback: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    background: "#1e293b",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  pendingName: { fontSize: 13, fontWeight: 600, color: "#f8fafc" },
  pendingSub: { fontSize: 11, color: "#64748b" },
  acceptMiniBtn: {
    background: "#10b981",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "4px 8px",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 2,
  },
  rejectMiniBtn: {
    background: "rgba(239, 68, 68, 0.15)",
    color: "#ef4444",
    border: "none",
    borderRadius: 6,
    padding: "4px 6px",
    cursor: "pointer",
  },

  listContainer: {
    flex: 1,
    overflowY: "auto",
    overflowX: "hidden",
    padding: "12px 14px",
    minHeight: 0,
    WebkitOverflowScrolling: "touch",
    overscrollBehavior: "contain",
  },
  listSectionHeader: { marginBottom: 8 },
  emptyListText: { fontSize: 12, color: "#64748b", padding: "6px 0" },
  chatListItem: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 12px",
    borderRadius: 12,
    cursor: "pointer",
    margin: "4px 0",
    transition: "background 0.18s",
  },
  chatListItemActive: {
    background: "rgba(99, 102, 241, 0.18)",
    border: "1px solid rgba(99, 102, 241, 0.35)",
  },
  chatListAvatar: {
    width: 38,
    height: 38,
    borderRadius: "50%",
    objectFit: "cover",
  },
  chatListAvatarFallback: {
    width: 38,
    height: 38,
    borderRadius: "50%",
    background: "#1e293b",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  onlineDot: {
    position: "absolute",
    bottom: -1,
    right: -1,
    width: 9,
    height: 9,
    borderRadius: "50%",
    background: "#10b981",
    border: "1.5px solid #101524",
  },
  groupAvatarBox: {
    width: 38,
    height: 38,
    borderRadius: "50%",
    background: "rgba(56, 189, 248, 0.12)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  chatListInfo: { flex: 1, minWidth: 0 },
  chatListTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "#f8fafc",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  chatListSub: { fontSize: 12, color: "#64748b", marginTop: 2 },
  newGroupBtn: {
    background: "none",
    border: "none",
    color: "#38bdf8",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: 4,
  },

  // Chat Window Area
  chatWindow: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    height: "100%",
    maxHeight: "100%",
    background: "#0a0e19",
    overflow: "hidden",
    position: "relative",
    minWidth: 0,
  },
  chatHeader: {
    padding: "12px 16px",
    background: "#101524",
    borderBottom: "1px solid rgba(255, 255, 255, 0.07)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexShrink: 0,
    position: "sticky",
    top: 0,
    zIndex: 50,
    width: "100%",
    boxSizing: "border-box",
  },
  backBtn: {
    background: "rgba(255,255,255,0.06)",
    border: "none",
    color: "#cbd5e1",
    padding: "6px 8px",
    borderRadius: 8,
    cursor: "pointer",
  },
  headerAvatarBox: { position: "relative" },
  chatHeaderAvatar: {
    width: 40,
    height: 40,
    borderRadius: "50%",
    objectFit: "cover",
  },
  chatHeaderTitle: { margin: 0, fontSize: 16, fontWeight: 700, color: "#f8fafc" },
  chatHeaderSub: { fontSize: 12, color: "#64748b", marginTop: 2 },
  callActionBtn: {
    background: "rgba(255, 255, 255, 0.05)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    padding: "8px 12px",
    borderRadius: 10,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background 0.2s",
  },
  closeChatHeaderBtn: {
    background: "rgba(239, 68, 68, 0.12)",
    border: "1px solid rgba(239, 68, 68, 0.25)",
    padding: "8px 12px",
    borderRadius: 10,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 4,
    transition: "all 0.2s",
  },

  messagesContainer: {
    flex: 1,
    padding: "16px 18px",
    overflowY: "auto",
    overflowX: "hidden",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    minHeight: 0,
    WebkitOverflowScrolling: "touch",
    overscrollBehavior: "contain",
  },
  messageRow: { display: "flex", alignItems: "flex-end", gap: 8 },
  msgAvatarWrapper: { flexShrink: 0 },
  msgAvatar: { width: 28, height: 28, borderRadius: "50%", objectFit: "cover" },
  msgAvatarFallback: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    background: "#1e293b",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  messageBubble: {
    maxWidth: "75%",
    padding: "10px 14px",
    borderRadius: 16,
    wordBreak: "break-word",
    boxShadow: "0 2px 6px rgba(0,0,0,0.18)",
  },
  messageBubbleMe: {
    background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
    color: "#ffffff",
    borderBottomRightRadius: 4,
  },
  messageBubbleOther: {
    background: "#161c30",
    color: "#f1f5f9",
    border: "1px solid rgba(255, 255, 255, 0.07)",
    borderBottomLeftRadius: 4,
  },
  msgSenderName: { fontSize: 11, fontWeight: 700, color: "#38bdf8", marginBottom: 4 },
  msgText: { fontSize: 14, lineHeight: 1.4 },
  msgTimestamp: { fontSize: 10, color: "rgba(255,255,255,0.45)", marginTop: 4 },

  // Image & Document Attachments
  msgImageContainer: { borderRadius: 10, overflow: "hidden", marginTop: 4 },
  msgImagePreview: {
    maxWidth: 260,
    maxHeight: 240,
    borderRadius: 10,
    objectFit: "cover",
    cursor: "pointer",
    display: "block",
  },
  captionText: { fontSize: 13, marginTop: 4 },
  documentCard: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "rgba(0, 0, 0, 0.22)",
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255, 255, 255, 0.08)",
  },
  docIconBox: {
    background: "rgba(56, 189, 248, 0.12)",
    padding: 8,
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  docInfo: { flex: 1, minWidth: 0 },
  docName: {
    fontSize: 13,
    fontWeight: 600,
    color: "#f8fafc",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  docSize: { fontSize: 11, color: "#94a3b8" },
  docDownloadBtn: {
    color: "#38bdf8",
    padding: 6,
    borderRadius: 6,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(255, 255, 255, 0.06)",
  },

  // Emoji Popover
  emojiPickerContainer: {
    position: "relative",
    background: "#161c30",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: 14,
    padding: 10,
    margin: "0 18px",
    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
  },
  emojiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(10, 1fr)",
    gap: 6,
  },
  emojiBtn: {
    background: "none",
    border: "none",
    fontSize: 20,
    cursor: "pointer",
    padding: 4,
    borderRadius: 6,
    transition: "transform 0.1s",
  },

  // Input Area
  inputArea: {
    display: "flex",
    alignItems: "center",
    padding: "12px 16px",
    background: "#101524",
    borderTop: "1px solid rgba(255, 255, 255, 0.07)",
    gap: 8,
    flexShrink: 0,
    position: "relative",
    zIndex: 20,
    width: "100%",
    boxSizing: "border-box",
  },
  attachBtn: {
    background: "rgba(255, 255, 255, 0.05)",
    border: "none",
    borderRadius: 10,
    padding: 9,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  emojiToggleBtn: {
    background: "rgba(255, 255, 255, 0.05)",
    border: "none",
    borderRadius: 10,
    padding: 9,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  chatInputField: {
    flex: 1,
    background: "rgba(255, 255, 255, 0.04)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: 22,
    padding: "10px 18px",
    color: "#f8fafc",
    outline: "none",
    fontSize: 14,
  },
  sendSubmitBtn: {
    background: "linear-gradient(135deg, #6366f1 0%, #3b82f6 100%)",
    border: "none",
    borderRadius: 22,
    padding: "10px 18px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 2px 10px rgba(99, 102, 241, 0.35)",
  },

  noChatPlaceholder: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    color: "#64748b",
    textAlign: "center",
    padding: 24,
  },
  noChatIconBox: {
    padding: 18,
    borderRadius: "50%",
    background: "rgba(99, 102, 241, 0.1)",
    marginBottom: 16,
  },
  noChatTitle: { fontSize: 18, fontWeight: 700, color: "#f8fafc", margin: "0 0 6px 0" },
  noChatSubtitle: { fontSize: 13, color: "#64748b", maxWidth: 320, lineHeight: 1.5 },

  // Incoming Call Modal
  callModalBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0, 0, 0, 0.75)",
    backdropFilter: "blur(8px)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 999,
  },
  incomingCallCard: {
    background: "#161c30",
    border: "1px solid rgba(99, 102, 241, 0.4)",
    borderRadius: 24,
    padding: "36px 32px",
    textAlign: "center",
    width: "100%",
    maxWidth: 320,
    boxShadow: "0 15px 35px rgba(0,0,0,0.6)",
  },
  callAvatarRing: {
    display: "inline-block",
    padding: 6,
    borderRadius: "50%",
    border: "2px dashed #6366f1",
  },
  callModalAvatar: {
    width: 80,
    height: 80,
    borderRadius: "50%",
    objectFit: "cover",
  },
  callModalAvatarFallback: {
    width: 80,
    height: 80,
    borderRadius: "50%",
    background: "#1e293b",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  callModalTitle: { fontSize: 20, fontWeight: 700, color: "#f8fafc", marginTop: 14 },
  callModalSubtitle: { fontSize: 13, color: "#38bdf8", marginTop: 4 },
  callActionsRow: {
    display: "flex",
    justifyContent: "center",
    gap: 28,
    marginTop: 28,
  },
  declineCallBtn: {
    width: 52,
    height: 52,
    borderRadius: "50%",
    background: "#ef4444",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 4px 14px rgba(239, 68, 68, 0.4)",
  },
  acceptCallBtn: {
    width: 52,
    height: 52,
    borderRadius: "50%",
    background: "#10b981",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 4px 14px rgba(16, 185, 129, 0.4)",
  },

  // Active Call Screen Overlay
  activeCallOverlay: {
    position: "fixed",
    inset: 0,
    background: "#090d16",
    zIndex: 998,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
  },
  remoteMediaContainer: {
    position: "absolute",
    inset: 0,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
  },
  remoteVideoElement: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  audioCallCenterBox: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    zIndex: 10,
  },
  audioWaveRing: {
    padding: 8,
    borderRadius: "50%",
    background: "rgba(99, 102, 241, 0.15)",
    boxShadow: "0 0 35px rgba(99, 102, 241, 0.35)",
  },
  activeCallBigAvatar: {
    width: 110,
    height: 110,
    borderRadius: "50%",
    objectFit: "cover",
  },
  activeCallBigAvatarFallback: {
    width: 110,
    height: 110,
    borderRadius: "50%",
    background: "#1e293b",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  pipVideoBox: {
    position: "absolute",
    top: 24,
    right: 24,
    width: 160,
    height: 110,
    borderRadius: 14,
    overflow: "hidden",
    border: "2px solid rgba(255,255,255,0.2)",
    boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
    zIndex: 20,
  },
  pipVideoElement: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  callControlsFloatingBar: {
    position: "absolute",
    bottom: 36,
    display: "flex",
    alignItems: "center",
    gap: 20,
    background: "rgba(16, 21, 36, 0.8)",
    backdropFilter: "blur(18px)",
    padding: "12px 24px",
    borderRadius: 40,
    border: "1px solid rgba(255, 255, 255, 0.1)",
    zIndex: 30,
  },
  callControlCircle: {
    width: 48,
    height: 48,
    borderRadius: "50%",
    border: "none",
    color: "#fff",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background 0.2s",
  },
  hangupCircleBtn: {
    width: 52,
    height: 52,
    borderRadius: "50%",
    background: "#ef4444",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 4px 14px rgba(239, 68, 68, 0.4)",
  },

  // Lightbox
  lightboxBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.85)",
    backdropFilter: "blur(10px)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
    padding: 20,
  },
  lightboxImage: {
    maxWidth: "90vw",
    maxHeight: "90vh",
    borderRadius: 12,
    objectFit: "contain",
  },
  lightboxCloseBtn: {
    position: "absolute",
    top: 24,
    right: 24,
    background: "rgba(255,255,255,0.1)",
    border: "none",
    borderRadius: "50%",
    width: 40,
    height: 40,
    color: "#fff",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  // Modal (Create Group)
  modalBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0, 0, 0, 0.65)",
    backdropFilter: "blur(6px)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 900,
    padding: 20,
  },
  modalCard: {
    background: "#161c30",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: 18,
    padding: 24,
    width: "100%",
    maxWidth: 380,
    boxShadow: "0 15px 35px rgba(0,0,0,0.5)",
  },
  modalHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  modalTitle: { fontSize: 17, fontWeight: 700, color: "#f8fafc", margin: 0 },
  modalCloseBtn: {
    background: "none",
    border: "none",
    color: "#94a3b8",
    cursor: "pointer",
  },
  groupMembersList: {
    maxHeight: 150,
    overflowY: "auto",
    background: "rgba(0, 0, 0, 0.2)",
    borderRadius: 10,
    padding: 8,
    border: "1px solid rgba(255, 255, 255, 0.05)",
  },
  groupCheckboxRow: {
    display: "flex",
    alignItems: "center",
    fontSize: 13,
    padding: "6px 8px",
    cursor: "pointer",
  },
  modalFooterRow: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 20,
  },
  cancelBtn: {
    padding: "10px 16px",
    background: "rgba(255, 255, 255, 0.05)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    color: "#cbd5e1",
    borderRadius: 10,
    cursor: "pointer",
    fontSize: 13,
  },

  // Skeleton Loaders
  skeletonContactRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "8px 12px",
    borderRadius: 12,
    background: "rgba(255, 255, 255, 0.02)",
    marginBottom: 6,
  },
  skeletonChatContainer: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    padding: "12px 0",
  },

  // Staged File Preview Card
  stagedFileBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 14px",
    background: "rgba(15, 23, 42, 0.95)",
    border: "1px solid rgba(56, 189, 248, 0.35)",
    borderRadius: 14,
    marginBottom: 8,
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
    backdropFilter: "blur(10px)",
  },
  stagedFileInfo: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    overflow: "hidden",
  },
  stagedImageThumb: {
    width: 44,
    height: 44,
    borderRadius: 8,
    objectFit: "cover",
    border: "1px solid rgba(255, 255, 255, 0.15)",
    flexShrink: 0,
  },
  stagedDocIcon: {
    width: 44,
    height: 44,
    borderRadius: 8,
    background: "rgba(56, 189, 248, 0.12)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid rgba(56, 189, 248, 0.25)",
    flexShrink: 0,
  },
  stagedFileName: {
    fontSize: 13,
    fontWeight: 600,
    color: "#f1f5f9",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: 240,
  },
  stagedFileSize: {
    fontSize: 11,
    color: "#38bdf8",
    marginTop: 2,
  },
  removeStagedBtn: {
    background: "rgba(239, 68, 68, 0.15)",
    border: "1px solid rgba(239, 68, 68, 0.3)",
    color: "#f87171",
    borderRadius: "50%",
    width: 28,
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flexShrink: 0,
  },

  // Message Bottom Row & Actions
  msgBottomRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
    justifyContent: "flex-end",
  },
  msgStatusBadge: {
    display: "inline-flex",
    alignItems: "center",
    fontSize: 11,
  },
  msgDeleteBtn: {
    background: "transparent",
    border: "none",
    color: "#94a3b8",
    cursor: "pointer",
    padding: "2px 4px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
    opacity: 0.6,
    transition: "opacity 0.2s, color 0.2s",
  },
  deletedMsgBox: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "4px 2px",
    color: "#94a3b8",
    fontSize: 13,
  },

  // Delete Modal Card
  deleteModalCard: {
    background: "#161c30",
    border: "1px solid rgba(239, 68, 68, 0.3)",
    borderRadius: 18,
    padding: 24,
    width: "100%",
    maxWidth: 390,
    boxShadow: "0 20px 45px rgba(0, 0, 0, 0.6)",
  },
  deleteModalHeader: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    marginBottom: 18,
  },
  deleteModalIcon: {
    width: 44,
    height: 44,
    borderRadius: "50%",
    background: "rgba(239, 68, 68, 0.15)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  deleteModalSubtitle: {
    fontSize: 13,
    color: "#94a3b8",
    margin: "4px 0 0 0",
  },
  deleteOptionsCol: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    marginTop: 10,
  },
  deleteEveryoneBtn: {
    width: "100%",
    textAlign: "left",
    padding: "12px 16px",
    background: "linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(220, 38, 38, 0.1) 100%)",
    border: "1px solid rgba(239, 68, 68, 0.4)",
    borderRadius: 12,
    color: "#fca5a5",
    cursor: "pointer",
  },
  deleteForMeBtn: {
    width: "100%",
    textAlign: "left",
    padding: "12px 16px",
    background: "rgba(255, 255, 255, 0.05)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: 12,
    color: "#e2e8f0",
    cursor: "pointer",
  },
};