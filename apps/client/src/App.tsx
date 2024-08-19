import { useEffect, useRef, useState } from "react";
import { server } from "server/index";
import classes from "./utils/classes";

interface ChatMessage {
  user: string;
  timestamp: string;
  message: string;
}

type CurrentRoom = {
  id: string;
  title: string;
  ws: WebSocket;
  username: string;
}

export default function App() {
  const [rooms, setRooms] = useState<{
    id: string;
    title: string;
  }[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentRoom, setCurrentRoom] = useState<CurrentRoom | null>(null);

  const messageRef = useRef<HTMLDivElement>(null);
  const callMessageRef = useRef<HTMLDivElement>(null);

  const [calling, setCalling] = useState<boolean>(false);
  const [callWS, setCallWS] = useState<WebSocket | null>(null);

  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);

  const [whiteboard, setWhiteboard] = useState<boolean>(false);
  const [whiteboardWS, setWhiteboardWS] = useState<WebSocket | null>(null);
  const whiteboardCanvas = useRef<HTMLCanvasElement>(null);

  const Message = ({ user, timestamp, message }: ChatMessage) => {
    return (
      <div className="flex flex-col gap-2 p-2 w-full rounded">
        <div className="flex flex-row items-center justify-between">
          <span className={classes(
            user == currentRoom?.username ? "text-blue-500" : "text-white",
          )}>
            {user}
          </span>
          <span className="text-gray-400 text-sm">
            {new Date(timestamp).toLocaleString()}
          </span>
        </div>
        <span className="text-white">{message}</span>
      </div>
    )
  }

  const join_room = (room: { id: string, title: string }) => {
    if (currentRoom) currentRoom.ws.close();

    setCurrentRoom(null);
    setMessages([]);

    let name = prompt("Enter your username");

    while (name && name?.length < 3) {
      name = prompt("Username must be at least 3 characters");
    }

    if (!name) {
      alert("Username is required");
      return;
    }

    const ws = server.api.chat.rooms[room.id].subscribe({
      $query: {
        name
      }
    });

    ws.on("open", () => {
      console.log("Connected");
      setCurrentRoom({ ...room, username: name, ws: ws.ws });
    });

    ws.on("close", () => {
      console.log("Disconnected");
      setCurrentRoom(null);
      setMessages([]);
    });

    ws.on("message", (m) => {
      try {
        const message = m.data as ChatMessage;
        setMessages(prev => [...prev, message]);
      } catch (e) {
        console.error(e);
      }

    });

    ws.on("error", console.error);
  }

  const join_call = () => {
    if (!currentRoom) return;

    const peerConnection = new RTCPeerConnection({
      iceServers: [
        {
          urls: "stun:stun.l.google.com:19302"
        }
      ],
      iceCandidatePoolSize: 10
    });
    
    setCalling(true);
    const ws = server.api.chat.calls[currentRoom.id].subscribe({
      $query: {
        name: currentRoom.username
      }
    });
    setCallWS(ws.ws);

    peerConnection.onicecandidate = (e) => {
      if (e.candidate) {
        ws.send(JSON.stringify({
          type: "candidate",
          data: e.candidate
        }));
      }
    }

    peerConnection.ontrack = (e) => {
      if (remoteVideo.current) remoteVideo.current.srcObject = e.streams[0];
    }

    peerConnection.sctp?.addEventListener("statechange", (e) => {
      console.log("SCTP State", e);
    })

    ws.on("open", () => {
      console.log("Connected to call");
      currentRoom.ws.send("Joining call");
      
      const constraints = {
        video: true,
        audio: true
      };

      navigator.mediaDevices.getUserMedia(constraints)
        .then((stream) => {
          // localVideo.current!.srcObject = stream;
          if (localVideo.current) {
            localVideo.current.srcObject = stream;
          }

          stream.getTracks()
            .forEach(track => peerConnection.addTrack(track, stream));

          ws.on("message", (m) => {
            const message = m.data as {
              type: "join" | "offer" | "answer" | "candidate";
              data: unknown;
            };

            if (message.type === "join") {
              console.log("Joining call");
              peerConnection?.createOffer().then((offer) => {
                peerConnection?.setLocalDescription(offer);
                ws.send(JSON.stringify({
                  type: "offer",
                  data: offer
                }));
              });
            }

            if (message.type === "offer") {
              peerConnection?.setRemoteDescription(new RTCSessionDescription(message.data as RTCSessionDescription));
              peerConnection?.createAnswer().then((answer) => {
                peerConnection?.setLocalDescription(answer);
                ws.send(JSON.stringify({
                  type: "answer",
                  data: answer
                }));
              });
            }

            if (message.type === "answer") {
              peerConnection?.setRemoteDescription(new RTCSessionDescription(message.data as RTCSessionDescription));
            }

            if (message.type === "candidate") {
              peerConnection?.addIceCandidate(new RTCIceCandidate(message.data as RTCIceCandidate));
            }
          });
        }).catch(console.error);
      
    });

    ws.on("close", () => {
      console.log("Disconnected from call");
      setCalling(false);
      setCallWS(null);
      peerConnection.close();
    });

    ws.on("message", (m) => {
      const message = m.data as {
        type: "join" | "offer" | "answer" | "candidate" | "leave";
        data: unknown;
      };

      switch (message.type) {
        case "join":
          console.log("Joining call");
          // Send offer
          peerConnection.createOffer().then((offer) => {
            peerConnection?.setLocalDescription(offer);
            ws.send(JSON.stringify({
              type: "offer",
              data: offer
            }));
          });
          break;
        case "offer":
          // Send answer
          peerConnection.setRemoteDescription(new RTCSessionDescription(message.data as RTCSessionDescription));
          peerConnection.createAnswer().then((answer) => {
            peerConnection.setLocalDescription(answer);
            ws.send(JSON.stringify({
              type: "answer",
              data: answer
            }));
          });
          console.log("Received offer");
          break;
        case "answer":
          // Confirm answer
          peerConnection.setRemoteDescription(new RTCSessionDescription(message.data as RTCSessionDescription));
          console.log("Answered call");
          break;
        case "candidate":
          peerConnection.addIceCandidate(new RTCIceCandidate(message.data as RTCIceCandidate));
          console.log("Received candidate");
          break;
        case "leave":
          // Disconnect somepee
          break;
        default:
          break;
      }
    });
  }

  const end_call = () => callWS?.close();

  const join_whiteboard = () => {
    // alert("Not implemented");

    const ws = server.api.chat.whiteboard[currentRoom!.id].subscribe({
      $query: {
        name: currentRoom!.username
      }
    });

    ws.on("open", () => {
      console.log("Connected to whiteboard");
      setWhiteboardWS(ws.ws);
      setWhiteboard(true);
    });

    ws.on("close", () => {
      console.log("Disconnected from whiteboard");
    });

    ws.on("message", (m) => {
      const message = m.data as {
        type: "join" | "draw" | "clear" | "leave";
        data: unknown;
      };

      switch (message.type) {
        case "join":
          console.log("Joining whiteboard");
          break;
        case "draw":
          console.log("Drawing on whiteboard");
          if (whiteboardCanvas.current) {
            const canvas = whiteboardCanvas.current;
            const ctx = canvas.getContext("2d");

            if (ctx) {
              const { x, y } = message.data as { x: number, y: number };

              if (x == -1 && y == -1) {
                ctx.closePath();
              } else {
                ctx.lineTo(x, y);
                ctx.stroke();
              }
            }
          }
          break;
        case "clear":
          console.log("Clearing whiteboard");
          break;
        case "leave":
          console.log("Leaving whiteboard");
          break;
        default:
          break;
      }
    });
  }

  useEffect(() => {
    if (messageRef.current) messageRef.current.scrollTop = messageRef.current.scrollHeight;
    if (callMessageRef.current) {
      // scroll to bottom
      callMessageRef.current.scrollTop = callMessageRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (whiteboardCanvas.current) {
      const canvas = whiteboardCanvas.current;
      const ctx = canvas.getContext("2d");

      // Set canvas size
      canvas.width = canvas.clientWidth;

      // Set canvas style
      ctx!.lineCap = "round";

      // Set canvas event hold click and draw
      let drawing = false;
      let lastX = 0;
      let lastY = 0;

      canvas.addEventListener("mousedown", (e) => {
        drawing = true;
        lastX = e.offsetX;
        lastY = e.offsetY;

        ctx!.beginPath();
        ctx!.moveTo(lastX, lastY);
      });

      canvas.addEventListener("mousemove", (e) => {
        if (drawing) {
          const x = e.offsetX;
          const y = e.offsetY;

          ctx!.lineTo(x, y);
          ctx!.stroke();

          whiteboardWS?.send(JSON.stringify({ type: "draw", data: { x, y } }));
        }
      });

      canvas.addEventListener("mouseup", () => {
        drawing = false;
        whiteboardWS?.send(JSON.stringify({ type: "draw", data: { x: -1, y: -1 } }));
      });

      canvas.addEventListener("mouseleave", () => {
        drawing = false;
        whiteboardWS?.send(JSON.stringify({ type: "draw", data: { x: -1, y: -1 } }));
      });

      return () => {
        canvas.removeEventListener("mousedown", () => {});
        canvas.removeEventListener("mousemove", () => {});
        canvas.removeEventListener("mouseup", () => {});
        canvas.removeEventListener("mouseleave", () => {});
      }
    }
  }, [whiteboardCanvas, whiteboardWS]);

  useEffect(() => {
    server.api.chat.rooms.get().then(({ data }) => {
      if (data != null) setRooms(data);
    }).catch(console.error);

    const ws = server.api.chat.rooms.subscribe();

    ws.on("message", (m) => {
      const { message, room } = m.data as { message: string, room: { id: string, title: string } };

      if (message == "Created") {
        if (!rooms.find(r => r.id == room.id)) setRooms(prev => [...prev, room]);
      }

      if (message == "Deleted") {
        setRooms(prev => prev.filter(r => r.id != room.id));
      }
    });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="w-screen h-screen max-h-screen grid grid-cols-3 md:grid-cols-12 gap-2 p-4 bg-black relative overflow-hidden">
      {/* Video Call Overlay */}
      { calling && (
        <div className="absolute z-50 w-full h-full bg-gray-900/50">
          <div className="w-full h-full max-h-max bg-black/90 rounded-xl flex flex-col p-4 shadow relative">
            <h1 className="text-2xl text-white">Video Call: Not implemented</h1>
            <span className="text-lg text-white">0:00:00</span>
            <div className="w-full h-full max-h-max py-4 flex flex-row gap-2 relative">
              <div className={
                classes(
                  "w-2/3 h-full max-h-max bg-gray-800 rounded relative",
                  // "grid gap-2 grid-row-3",
                )
              }>
                <div className="absolute aspect-video w-4/5 top-4 left-1/2 right-1/2 transform -translate-x-1/2">
                  <div className="w-full h-full relative">
                    <video ref={remoteVideo} className="w-full h-full object-cover aspect-video" autoPlay muted />
                    <div className="absolute bottom-2 right-2 z-10 flex flex-row gap-2 text-white">
                      Remote Video
                    </div>
                  </div>
                </div>

                <div className="absolute aspect-video w-1/5 bottom-4 right-4">
                  <div className="w-full h-full relative">
                    <video ref={localVideo} className="w-full h-full object-cover aspect-video" autoPlay muted />
                    <div className="absolute bottom-2 right-2 z-10 flex flex-row gap-2 text-white">
                      Local Video
                    </div>
                  </div>
                </div>
              </div>
              <div className="w-1/3 h-full max-h-max bg-gray-800 rounded flex flex-col gap-2 p-2 relative">
                <div className="p-2 w-[95%] h-[calc(100%-4rem)] max-h-max overflow-y-scroll absolute" ref={callMessageRef}>
                  { messages.map((message, i) => <Message key={i} {...message} />) }
                </div>
                <form 
                  className="flex flex-row gap-2 absolute bottom-2 z-10 items-center bg-gray-800 justify-center rounded w-full left-0 px-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    
                    const formData = new FormData(e.target as HTMLFormElement);
                    const message = formData.get("message") as string;

                    currentRoom!.ws.send(message);

                    (e.target as HTMLFormElement).reset();
                  }}
                >
                  <input type="text" placeholder="Message" name="message" className="p-2 w-full rounded text-black" required />
                  <button type="submit" className="p-2 bg-blue-500 text-white rounded">Send</button>
                </form>
              </div>
            </div>
            <div className="w-full flex flex-row items-center justify-center gap-2">
              <button 
                className="p-2 bg-red-500 text-white rounded"
                onClick={end_call}
              >
                End Call
              </button>

              {/* <button 
                className="p-2 bg-blue-500 text-white rounded"
                onClick={() => {
                  alert("Not implemented");
                }}
              >
                Share Screen
              </button> */}

              <button
                className="p-2 bg-green-500 text-white rounded"
                onClick={() => {
                  alert("Not implemented");
                }}
              >
                Camera
              </button>

              <button
                className="p-2 bg-green-500 text-white rounded"
                onClick={() => {
                  alert("Not implemented");
                }}
              >
                Microphone
              </button>
            </div>
          </div>
        </div>
      ) }

      {/* Whiteboard */}
      {
        whiteboard && (
          <div className="w-screen h-screen max-h-screen absolute bg-black/80 p-4 z-50">
            <canvas className="w-full aspect-video max-h-full bg-white rounded" ref={whiteboardCanvas} />

            <button 
              className="p-2 bg-red-500 text-white rounded absolute top-2 right-2"
              onClick={() => {
                if (!confirm("Are you sure you want to leave the whiteboard?")) return;
                whiteboardWS?.close();
                setWhiteboard(false);
              }}
            >
              Leave
            </button>
          </div>
        )
      }

      {/* Side bar */}
      <div 
        className={
          classes(
            "col-span-3 bg-gray-800 text-white rounded-xl p-2 flex flex-col",
            "relative max-h-fit justify-between",
            currentRoom ? "hidden md:block" : "block"
          )
        }
      >
        <h1 className="p-2 text-2xl bg-gray-800 w-[calc(100%-0.8rem)] absolute z-10">Chat Rooms</h1>
        <div className="p-2 pl-0 top-16 w-[calc(100%-0.8rem)] h-[calc(100%-11rem)] flex-grow flex flex-col gap-2 overflow-y-auto absolute max-h-[calc(100dvh-9rem)] z-0">
          {
            rooms && rooms.map((room) => {
              return (
                <button 
                  key={room.id} 
                  className={
                    classes(
                      "flex flex-row p-2 rounded",
                      "w-full", currentRoom?.id == room.id ? "bg-blue-500 text-white" : "bg-gray-300 text-black"
                    )
                  }
                  onClick={() => {
                    if (currentRoom?.id == room.id) {
                      // Alert to confirm leaving room
                      if (!confirm("Are you sure you want to leave this room?")) return;
                      currentRoom.ws.close();
                      setCurrentRoom(null);
                      setMessages([]);
                      return;
                    }
                    join_room(room)
                  }}>
                  {room.title}
                </button>
              )
            })
          }
        </div>
        <form 
          className="pr-4 pb-2 w-full flex flex-col gap-2 absolute bottom-0 z-10"
          onSubmit={(e) => {
            e.preventDefault();
            
            const formData = new FormData(e.target as HTMLFormElement);
            const title = formData.get("title") as string;

            server.api.chat.rooms.post({ title }).then(({ data, status }) => {
              if (data != null) {
                if (status == 201) {
                  if (data.room) {
                    join_room(data.room);
                  }
                } else {
                  alert(data.message);
                }
              }
            });

            (e.target as HTMLFormElement).reset();
          }}
        >
          <input type="text" placeholder="Room name" name="title" className="p-2 rounded text-black" required />
          <button type="submit" className="p-2 bg-blue-500 text-white rounded">Create</button>
        </form>
      </div>

      {/* Content */}
      <div className={
        classes(
          "col-span-3 md:col-span-9 bg-gray-700 text-white rounded-xl p-2 relative max-h-fit",
          currentRoom ? "block" : "hidden md:block"
        )
      }>
        { currentRoom ? (
          <div className="w-full h-full gap-2 flex flex-col relative">
            <div className="flex flex-row justify-between p-2 absolute top-0 z-10 bg-gray-700 w-full">
              <h1 className="text-2xl">{currentRoom.title}</h1>
              <div className="flex flex-row gap-2">
                <button className="p-2 bg-white text-black rounded" onClick={join_whiteboard}>
                  Whiteboard
                </button>
                <button
                  className="p-2 bg-blue-500 text-white rounded"
                  onClick={() => {
                    if (!confirm("Are you sure you want to join a call?")) return;
                    join_call();
                  }}
                >
                  Join Call
                </button>
                <button
                  className="p-2 bg-red-500 text-white rounded"
                  onClick={() => {
                    if (!confirm("Are you sure you want to leave this room?")) return;
                    currentRoom.ws.close();
                    setCurrentRoom(null);
                    setMessages([]);
                  }}
                >
                  Leave Room
                </button>
              </div>
            </div>
            <div className="p-2 w-full h-auto max-h-[calc(100dvh-9rem)] z-0 absolute top-10 overflow-y-auto" ref={messageRef}>
              {
                messages.map((message, i) => <Message key={i} {...message} />)
              }
            </div>
            <form 
              className="p-2 pb-2 w-full flex flex-row gap-2 absolute bottom-0 z-10 items-center bg-gray-700 justify-center rounded"
              onSubmit={(e) => {
                e.preventDefault();
                
                const formData = new FormData(e.target as HTMLFormElement);
                const message = formData.get("message") as string;

                currentRoom.ws.send(message);

                (e.target as HTMLFormElement).reset();
              }}
            >
              <div className="flex-grow flex flex-col">
                <input type="text" placeholder={`${currentRoom.username}`} name="message" className="p-2 w-full rounded text-black" required />
              </div>
              <button type="submit" className="p-2 bg-blue-500 text-white rounded">Send</button>
            </form>
          </div>
        ) : (
          <div className="flex flex-col h-full justify-center items-center">
            <h1 className="p-2 text-2xl">Select a room</h1>
          </div>
        ) }
      </div>
    </div>
  )
}