package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

type Point struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Color  string  `json:"color"`
	UserID string  `json:"userId"`
}

type DrawingUpdate struct {
	Type   string  `json:"type"`
	Points []Point `json:"points"`
	UserID string  `json:"userId"`
}

type UsersUpdate struct {
	Type  string   `json:"type"`
	Users []string `json:"users"`
}

type Hub struct {
	clients    map[*Client]bool
	broadcast  chan []byte
	register   chan *Client
	unregister chan *Client
	state      []Point
	mu         sync.RWMutex
	logger     *zap.Logger
}

type Client struct {
	hub  *Hub
	conn *websocket.Conn
	send chan []byte
	id   string
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins in development
	},
}

func newHub() *Hub {
	logger, _ := zap.NewDevelopment()
	return &Hub{
		broadcast:  make(chan []byte),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		clients:    make(map[*Client]bool),
		state:      make([]Point, 0),
		logger:     logger,
	}
}

func (h *Hub) run() {
	for {
		select {
		case client := <-h.register:
			h.clients[client] = true
			h.broadcastUsers()
			
			// Send current state to new client
			h.mu.RLock()
			if len(h.state) > 0 {
				update := DrawingUpdate{
					Type:   "draw",
					Points: h.state,
				}
				data, _ := json.Marshal(update)
				client.send <- data
			}
			h.mu.RUnlock()

		case client := <-h.unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
				h.broadcastUsers()
			}

		case message := <-h.broadcast:
			var update DrawingUpdate
			if err := json.Unmarshal(message, &update); err != nil {
				h.logger.Error("Failed to unmarshal message", zap.Error(err))
				continue
			}

			// Update state
			h.mu.Lock()
			h.state = append(h.state, update.Points...)
			h.mu.Unlock()

			// Broadcast to all clients
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					close(client.send)
					delete(h.clients, client)
				}
			}
		}
	}
}

func (h *Hub) broadcastUsers() {
	users := make([]string, 0, len(h.clients))
	for client := range h.clients {
		users = append(users, client.id)
	}

	update := UsersUpdate{
		Type:  "users",
		Users: users,
	}
	data, _ := json.Marshal(update)

	for client := range h.clients {
		client.send <- data
	}
}

func serveWs(hub *Hub, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		hub.logger.Error("Failed to upgrade connection", zap.Error(err))
		return
	}

	client := &Client{
		hub:  hub,
		conn: conn,
		send: make(chan []byte, 256),
		id:   r.URL.Query().Get("userId"),
	}
	client.hub.register <- client

	go client.writePump()
	go client.readPump()
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				c.hub.logger.Error("WebSocket read error", zap.Error(err))
			}
			break
		}
		c.hub.broadcast <- message
	}
}

func (c *Client) writePump() {
	defer func() {
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				c.hub.logger.Error("WebSocket write error", zap.Error(err))
				return
			}
		}
	}
}

func main() {
	hub := newHub()
	go hub.run()

	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		serveWs(hub, w, r)
	})

	port := ":8080"
	log.Printf("Starting server on %s", port)
	log.Fatal(http.ListenAndServe(port, nil))
}