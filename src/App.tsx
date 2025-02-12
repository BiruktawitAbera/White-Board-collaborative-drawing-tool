import React, { useEffect, useRef, useState } from 'react';
import useWebSocket from 'react-use-websocket';
import { Users, Wifi, WifiOff, Pencil, Eraser, Square, Circle, Type, Trash2 } from 'lucide-react';

interface Point {
  x: number;
  y: number;
  color: string;
  userId: string;
  tool: string;
  size?: number;
  isStart?: boolean;
  text?: string;
}


type Tool = 'pen' | 'eraser' | 'square' | 'circle' | 'text';

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#000000');
  const [connectedUsers, setConnectedUsers] = useState<string[]>([]);
  const [points, setPoints] = useState<Point[]>([]);
  const [selectedTool, setSelectedTool] = useState<Tool>('pen');
  const [size, setSize] = useState(2);
  const [text, setText] = useState('');
  const [showTextInput, setShowTextInput] = useState(false);
  const [textPosition, setTextPosition] = useState({ x: 0, y: 0 });
  const lastPoint = useRef<Point | null>(null);
  const startPoint = useRef<Point | null>(null);
  const currentShape = useRef<Point[]>([]);
  
  const { sendMessage, lastMessage, readyState } = useWebSocket('ws://localhost:8080/ws', {
    onOpen: () => console.log('Connected to server'),
    onClose: () => console.log('Disconnected from server'),
    shouldReconnect: () => true,
  });

  useEffect(() => {
    const resizeCanvas = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const { width } = container.getBoundingClientRect();
      const height = width * 0.75;
      
      canvas.width = width;
      canvas.height = height;
      redrawCanvas();
    };

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
    return () => window.removeEventListener('resize', resizeCanvas);
  }, []);

  useEffect(() => {
    if (lastMessage) {
      const data = JSON.parse(lastMessage.data);
      if (data.type === 'draw') {
        setPoints(prev => [...prev, ...data.points]);
      } else if (data.type === 'clear') {
        setPoints([]);
      } else if (data.type === 'users') {
        setConnectedUsers(data.users);
      }
    }
  }, [lastMessage]);

  const redrawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    let currentPath: Point[] = [];
    points.forEach((point) => {
      if (point.tool === 'text' && point.text) {
        drawText(ctx, point);
        return;
      }

      if (point.isStart) {
        if (currentPath.length > 0) {
          if (currentPath[0].tool === 'pen' || currentPath[0].tool === 'eraser') {
            drawPath(ctx, currentPath);
          } else if (currentPath[0].tool === 'square') {
            drawSquare(ctx, currentPath[0], currentPath[currentPath.length - 1]);
          } else if (currentPath[0].tool === 'circle') {
            drawCircle(ctx, currentPath[0], currentPath[currentPath.length - 1]);
          }
        }
        currentPath = [point];
      } else {
        currentPath.push(point);
      }
    });

    if (currentPath.length > 0) {
      if (currentPath[0].tool === 'pen' || currentPath[0].tool === 'eraser') {
        drawPath(ctx, currentPath);
      } else if (currentPath[0].tool === 'square') {
        drawSquare(ctx, currentPath[0], currentPath[currentPath.length - 1]);
      } else if (currentPath[0].tool === 'circle') {
        drawCircle(ctx, currentPath[0], currentPath[currentPath.length - 1]);
      }
    }
  };

  useEffect(() => {
    redrawCanvas();
  }, [points]);

  const drawPath = (ctx: CanvasRenderingContext2D, pathPoints: Point[]) => {
    if (pathPoints.length < 2) return;
    
    ctx.beginPath();
    ctx.moveTo(pathPoints[0].x, pathPoints[0].y);
    
    for (let i = 1; i < pathPoints.length; i++) {
      ctx.lineTo(pathPoints[i].x, pathPoints[i].y);
    }
    
    ctx.strokeStyle = pathPoints[0].tool === 'eraser' ? '#ffffff' : pathPoints[0].color;
    ctx.lineWidth = pathPoints[0].size || 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  };

  const drawSquare = (ctx: CanvasRenderingContext2D, start: Point, end: Point) => {
    const width = end.x - start.x;
    const height = end.y - start.y;
    
    ctx.beginPath();
    ctx.strokeStyle = start.color;
    ctx.lineWidth = start.size || 2;
    ctx.strokeRect(start.x, start.y, width, height);
  };

  const drawCircle = (ctx: CanvasRenderingContext2D, center: Point, radiusPoint: Point) => {
    const radius = Math.sqrt(
      Math.pow(radiusPoint.x - center.x, 2) + 
      Math.pow(radiusPoint.y - center.y, 2)
    );
    
    ctx.beginPath();
    ctx.strokeStyle = center.color;
    ctx.lineWidth = center.size || 2;
    ctx.arc(center.x, center.y, radius, 0, 2 * Math.PI);
    ctx.stroke();
  };

  const drawText = (ctx: CanvasRenderingContext2D, point: Point) => {
    ctx.font = `${point.size || 16}px Arial`;
    ctx.fillStyle = point.color;
    ctx.fillText(point.text || '', point.x, point.y);
  };

  const getCanvasPoint = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const point = getCanvasPoint(e);
    if (!point) return;

    if (selectedTool === 'text') {
      setTextPosition(point);
      setShowTextInput(true);
      return;
    }
    
    setIsDrawing(true);
    const newPoint = { 
      ...point,
      color, 
      userId: 'self',
      tool: selectedTool,
      size: selectedTool === 'eraser' ? 20 : size,
      isStart: true
    };

    lastPoint.current = newPoint;
    startPoint.current = newPoint;
    currentShape.current = [newPoint];
    
    if (selectedTool === 'pen' || selectedTool === 'eraser') {
      setPoints(prev => [...prev, newPoint]);
      sendMessage(JSON.stringify({
        type: 'draw',
        points: [newPoint],
      }));
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !startPoint.current) return;
    
    const point = getCanvasPoint(e);
    if (!point) return;
    
    const newPoint = { 
      ...point,
      color, 
      userId: 'self',
      tool: selectedTool,
      size: selectedTool === 'eraser' ? 20 : size
    };

    if (selectedTool === 'pen' || selectedTool === 'eraser') {
      setPoints(prev => [...prev, newPoint]);
      sendMessage(JSON.stringify({
        type: 'draw',
        points: [newPoint],
      }));
    } else {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      redrawCanvas();

      if (selectedTool === 'square') {
        drawSquare(ctx, startPoint.current, newPoint);
      } else if (selectedTool === 'circle') {
        drawCircle(ctx, startPoint.current, newPoint);
      }
      
      currentShape.current = [startPoint.current, newPoint];
    }
  };

  const handleMouseUp = () => {
    if (isDrawing && (selectedTool === 'square' || selectedTool === 'circle') && currentShape.current.length === 2) {
      setPoints(prev => [...prev, ...currentShape.current]);
      sendMessage(JSON.stringify({
        type: 'draw',
        points: currentShape.current,
      }));
    }

    setIsDrawing(false);
    lastPoint.current = null;
    startPoint.current = null;
    currentShape.current = [];
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) {
      setShowTextInput(false);
      return;
    }

    const newPoint = {
      ...textPosition,
      color,
      userId: 'self',
      tool: 'text' as const,
      size,
      text,
      isStart: true
    };

    setPoints(prev => [...prev, newPoint]);
    sendMessage(JSON.stringify({
      type: 'draw',
      points: [newPoint],
    }));

    setText('');
    setShowTextInput(false);
  };

  const handleClear = () => {
    setPoints([]);
    sendMessage(JSON.stringify({
      type: 'clear',
      points: [],
      userId: 'self'
    }));
  };

  return (
    <div className="min-h-screen p-4 bg-gray-100 sm:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="p-4 bg-white rounded-lg shadow-lg sm:p-6">
          <div className="flex flex-col items-start justify-between gap-4 mb-6 sm:flex-row sm:items-center">
            <h1 className="text-2xl font-bold text-gray-800">Distributed Whiteboard</h1>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                <span>{connectedUsers.length} users</span>
              </div>
              {readyState === 1 ? (
                <Wifi className="w-5 h-5 text-green-500" />
              ) : (
                <WifiOff className="w-5 h-5 text-red-500" />
              )}
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedTool('pen')}
                className={`p-2 rounded ${selectedTool === 'pen' ? 'bg-blue-100' : 'hover:bg-gray-100'}`}
                title="Pen"
              >
                <Pencil className="w-5 h-5" />
              </button>
              <button
                onClick={() => setSelectedTool('eraser')}
                className={`p-2 rounded ${selectedTool === 'eraser' ? 'bg-blue-100' : 'hover:bg-gray-100'}`}
                title="Eraser"
              >
                <Eraser className="w-5 h-5" />
              </button>
              <button
                onClick={() => setSelectedTool('square')}
                className={`p-2 rounded ${selectedTool === 'square' ? 'bg-blue-100' : 'hover:bg-gray-100'}`}
                title="Square"
              >
                <Square className="w-5 h-5" />
              </button>
              <button
                onClick={() => setSelectedTool('circle')}
                className={`p-2 rounded ${selectedTool === 'circle' ? 'bg-blue-100' : 'hover:bg-gray-100'}`}
                title="Circle"
              >
                <Circle className="w-5 h-5" />
              </button>
              <button
                onClick={() => setSelectedTool('text')}
                className={`p-2 rounded ${selectedTool === 'text' ? 'bg-blue-100' : 'hover:bg-gray-100'}`}
                title="Text"
              >
                <Type className="w-5 h-5" />
              </button>
              <button
                onClick={handleClear}
                className="p-2 rounded hover:bg-red-100"
                title="Clear Canvas"
              >
                <Trash2 className="w-5 h-5 text-red-500" />
              </button>
            </div>
            
            <div className="flex items-center gap-2">
              <label>
                Color:
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="ml-2"
                  disabled={selectedTool === 'eraser'}
                />
              </label>
            </div>

            <div className="flex items-center gap-2">
              <label>
                Size:
                <input
                  type="range"
                  min="1"
                  max="50"
                  value={size}
                  onChange={(e) => setSize(parseInt(e.target.value))}
                  className="ml-2"
                />
              </label>
            </div>
          </div>

          <div ref={containerRef} className="relative w-full">
            <canvas
              ref={canvasRef}
              className="w-full border border-gray-300 rounded-lg cursor-crosshair"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            />
            {showTextInput && (
              <div
                className="absolute"
                style={{
                  left: textPosition.x,
                  top: textPosition.y,
                }}
              >
                <form onSubmit={handleTextSubmit} className="p-2 bg-white rounded shadow-lg">
                  <input
                    type="text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    className="px-2 py-1 border rounded"
                    autoFocus
                    placeholder="Enter text..."
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      type="submit"
                      className="px-2 py-1 text-white bg-blue-500 rounded hover:bg-blue-600"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowTextInput(false)}
                      className="px-2 py-1 text-white bg-gray-500 rounded hover:bg-gray-600"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;