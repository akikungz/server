import { Elysia, t } from "elysia";

export interface Client {
    id: string;
    name: string;
    ws: unknown;
}

export interface ChatRoom {
    id: string;
    title: string;
    clients: Client[];
}

export interface Call {
    room_id: string;
    clients: Client[];
    offer: RTCSessionDescriptionInit | null; // Assign null as a valid value for offer
}

export default new Elysia(
    {
        name: "Chat api",
        prefix: "/chat",
        websocket: {
            idleTimeout: 65535
        }
    }
)
    .decorate('client', [] as any[])
    .decorate('rooms', [] as ChatRoom[])
    .decorate('timeouts', {} as Record<string, Timer>)
    .decorate('calls', {} as Record<string, Call>)
    .decorate('whiteboard', {} as Record<string, unknown[]>)
    .get("/rooms", ({ rooms }) => rooms.map(room => ({ id: room.id, title: room.title })))
    .post("/rooms", 
        ({ body: { title }, client, rooms, set }) => {
            if (rooms.filter(room => room.title == title).length == 0) {
                const new_room = {
                    id: Math.random().toString(36).substring(2),
                    title,
                    clients: []
                }
                rooms.push(new_room)

                client.forEach((ws) => {
                    ws.send(JSON.stringify({
                        room: {
                            id: new_room.id,
                            title: new_room.title
                        },
                        message: "Created"
                    }))
                })

                setTimeout(() => {
                    if (rooms.find(room => room.id == new_room.id)?.clients.length === 0) {
                        rooms.splice(rooms.findIndex(room => room.id == new_room.id), 1)

                        client.forEach((ws) => {
                            ws.send(JSON.stringify({
                                room: {
                                    id: new_room.id
                                },
                                message: "Deleted"
                            }))
                        })
                    }
                }, 60 * 1000)

                set.status = 201

                return {
                    message: "Room created",
                    room: new_room
                }
            } else {
                set.status = 400

                return {
                    message: "Room already exists",
                }
            }
        },
        {
            body: t.Object({
                title: t.String()
            })
        }
    )
    .ws("/rooms", {
        open: (ws) => {
            ws.data.client.push(ws as unknown)
            ws.send("Connected")
        },
        close: (ws) => {
            ws.data.client.splice(ws.data.client.findIndex((client) => client.id == ws.id), 1)
        }
    })
    .ws("/rooms/:id", {
        open: (ws) => {
            const room = ws.data.rooms.find(room => room.id == ws.data.params.id)
            if (!room) {
                ws.send("Room not found")
                ws.close()
                return;
            }

            if (!ws.data.query.name) {
                ws.send("Name is required")
                ws.close()
                return;
            }
            
            if (room.clients.find(client => client.name == ws.data.query.name)) {
                ws.send("Name already taken")
                ws.close()
                return;
            }

            room.clients.push({
                id: ws.id,
                name: ws.data.query.name,
                ws: ws.subscribe(room.id) // Pass the room ID as an argument to ws.subscribe()
            })

            if (ws.data.timeouts[ws.data.params.id]) {
                clearTimeout(ws.data.timeouts[ws.data.params.id])
            }

            // Broadcast message to all clients in the room
            room.clients.forEach(client => {
                (client.ws as typeof ws).send(
                    JSON.stringify({
                        timestamp: new Date().toISOString(),
                        user: "System",
                        message: `${ws.data.query.name} joined the room`
                    })
                )
            })
        },
        message: (ws, message) => {
            ws.data.rooms.find(room => room.id == ws.data.params.id)
                ?.clients.forEach(client => {
                    (client.ws as typeof ws).send(JSON.stringify({
                        timestamp: new Date().toISOString(),
                        user: ws.data.query.name,
                        message
                    }))
                })
        },
        close: (ws) => {
            ws.data.rooms.find(room => room.id == ws.data.params.id)
                ?.clients.splice(
                    ws.data.rooms.find(room => room.id == ws.data.params.id)
                        ?.clients.findIndex(client => client.id == ws.id) || 0,
                    1
                )

            // Broadcast message to all clients in the room
            ws.data.rooms.find(room => room.id == ws.data.params.id)
                ?.clients.forEach(client => {
                    (client.ws as typeof ws).send(
                        JSON.stringify({
                            timestamp: new Date().toISOString(),
                            user: "System",
                            message: `${ws.data.query.name} left the room`
                        })
                    )
                })

            // Check if the room is empty
            ws.data.timeouts[ws.data.params.id] = setTimeout(() => {
                const roomIndex = ws.data.rooms.findIndex(room => room.id == ws.data.params.id);
                if (roomIndex !== -1 && ws.data.rooms[roomIndex].clients.length === 0) {
                    ws.data.rooms.splice(roomIndex, 1);

                    ws.data.client.forEach((client) => {
                        client.send(
                            JSON.stringify({
                                room: {
                                    id: ws.data.params.id
                                },
                                message: "Deleted"
                            })
                        )
                    })
                }
            }, 60 * 1000)
        }
    })
    .ws("/calls/:id", {
        open: (ws) => {
            // Make sure the room exists
            if (!ws.data.rooms.find(room => room.id == ws.data.params.id)) {
                ws.send("Room not found")
                ws.close()
                return;
            }

            if (!ws.data.calls[ws.data.params.id]) {
                ws.data.calls[ws.data.params.id] = {
                    room_id: ws.data.params.id,
                    clients: [],
                    offer: null
                }
            }

            if (ws.data.calls[ws.data.params.id].clients.length > 2) {
                // Reject the call if there are more than 2 clients
                ws.send("Room is full")
                ws.close()
                return;
            }

            ws.data.calls[ws.data.params.id].clients.push({
                id: ws.id,
                name: ws.data.query.name!,
                ws: ws
            })

            // Broadcast message to all clients in the room
            ws.data.calls[ws.data.params.id].clients
                .filter(client => client.id !== ws.id)
                .forEach(client => {
                    (client.ws as typeof ws).send(JSON.stringify({
                        type: "join",
                        data: {
                            id: ws.id,
                            name: ws.data.query.name
                        }
                    }))
                })
        },
        message: (ws, m: unknown) => {
            const message = m as {
                type: "join" | "offer" | "answer" | "candidate" | "leave";
                data: unknown;
            }

            if (
                ws.data.calls[ws.data.params.id].clients.length > 2 &&
                ws.data.calls[ws.data.params.id].clients.find(client => client.id == ws.id)
            ) {
                ws.close();
                return;
            }

            // WebRTC signaling
            if (message.type === "offer") {
                ws.data.calls[ws.data.params.id].clients.forEach(client => {
                    if (client.id !== ws.id) {
                        (client.ws as typeof ws).send(JSON.stringify({
                            type: "offer",
                            data: message.data
                        }))
                    }
                })
            } else if (message.type === "answer") {
                ws.data.calls[ws.data.params.id].clients.forEach(client => {
                    if (client.id !== ws.id) {
                        (client.ws as typeof ws).send(JSON.stringify({
                            type: "answer",
                            data: message.data
                        }))
                    }
                })
            } else if (message.type === "candidate") {
                ws.data.calls[ws.data.params.id].clients.forEach(client => {
                    if (client.id !== ws.id) {
                        (client.ws as typeof ws).send(JSON.stringify({
                            type: "candidate",
                            data: message.data
                        }))
                    }
                })
            } else if (message.type === "leave") {
                ws.data.calls[ws.data.params.id].clients.forEach(client => {
                    if (client.id !== ws.id) {
                        (client.ws as typeof ws).send(JSON.stringify({
                            type: "leave",
                            data: {
                                id: ws.id
                            }
                        }))
                    }
                })
            } else if (message.type === "join") {
                ws.data.calls[ws.data.params.id].clients.forEach(client => {
                    if (client.id !== ws.id) {
                        (client.ws as typeof ws).send(JSON.stringify({
                            type: "join",
                            data: message.data
                        }))
                    }
                })
            }
        },
        close: (ws) => {
            if (ws.data.calls[ws.data.params.id]) {
                ws.data.calls[ws.data.params.id].clients.splice(
                    ws.data.calls[ws.data.params.id].clients.findIndex(client => (client as unknown as typeof ws).id == ws.id),
                    1
                )

                if (ws.data.calls[ws.data.params.id].clients.length === 0) {
                    delete ws.data.calls[ws.data.params.id]
                }
            }
        }
    })