import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Check, Type, Globe, Users, Sparkles, ArrowLeft, Send, Crop, Pencil, Undo } from "lucide-react";
import { fitToStoryAspect } from "../utils/mediaProcessor";
import ImageCropperModal from "./ImageCropperModal";

interface DrawingPath {
  points: { x: number; y: number }[];
  color: string;
}

interface StoryEditorProps {
  mediaSrc: string;
  mediaType: "image" | "video";
  onCancel: () => void;
  onPublish: (processedMedia: string, caption: string, audience: "everyone" | "followers") => void;
}

export default function StoryEditor({
  mediaSrc,
  mediaType,
  onCancel,
  onPublish,
}: StoryEditorProps) {
  const [processedSrc, setProcessedSrc] = useState<string>("");
  const [caption, setCaption] = useState("");
  const [audience, setAudience] = useState<"everyone" | "followers">("everyone");
  const [isProcessing, setIsProcessing] = useState(true);
  const [showCaptionInput, setShowCaptionInput] = useState(false);
  const [isCropperOpen, setIsCropperOpen] = useState(false);

  // Drawing state
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [paths, setPaths] = useState<DrawingPath[]>([]);
  const [currentPath, setCurrentPath] = useState<DrawingPath | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    async function process() {
      try {
        if (mediaType === "image") {
          const result = await fitToStoryAspect(mediaSrc);
          setProcessedSrc(result.dataUrl);
        } else {
          // For video, we just use the src as is for preview
          setProcessedSrc(mediaSrc);
        }
      } catch (err) {
        console.error("Story processing failed:", err);
        setProcessedSrc(mediaSrc);
      } finally {
        setIsProcessing(false);
      }
    }
    process();
  }, [mediaSrc, mediaType]);

  const handlePublish = () => {
    onPublish(processedSrc || mediaSrc, caption, audience);
  };

  const handleCropSave = (croppedBase64: string) => {
    setProcessedSrc(croppedBase64);
    setIsCropperOpen(false);
    // Clear paths if we re-crop
    setPaths([]);
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawingMode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = ('touches' in e) ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = ('touches' in e) ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    setCurrentPath({ points: [{ x, y }], color: "#DDF639" });
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawingMode || !currentPath) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = ('touches' in e) ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = ('touches' in e) ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    setCurrentPath({ ...currentPath, points: [...currentPath.points, { x, y }] });
  };

  const endDrawing = () => {
    if (currentPath) {
      setPaths([...paths, currentPath]);
      setCurrentPath(null);
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 5;

    const drawPath = (path: DrawingPath) => {
      if (path.points.length < 2) return;
      ctx.strokeStyle = path.color;
      ctx.beginPath();
      ctx.moveTo(path.points[0].x, path.points[0].y);
      for (let i = 1; i < path.points.length; i++) {
        ctx.lineTo(path.points[i].x, path.points[i].y);
      }
      ctx.stroke();
    };

    paths.forEach(drawPath);
    if (currentPath) drawPath(currentPath);
  }, [paths, currentPath, isDrawingMode]);

  const handleUndo = () => {
    setPaths(paths.slice(0, -1));
  };

  if (isProcessing) {
    return (
      <div className="fixed inset-0 z-[150] bg-black flex flex-col items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-10 h-10 border-2 border-[#DDF639] border-t-transparent rounded-full mb-4"
        />
        <p className="text-white text-xs font-bold uppercase tracking-widest">Optimizing Media...</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[150] bg-black flex flex-col items-center justify-center overflow-hidden">
      {/* 9:16 Canvas Area */}
      <div className="relative w-full max-w-[480px] aspect-[9/16] bg-[#1B1C1C] overflow-hidden shadow-2xl flex items-center justify-center">
        {mediaType === "image" ? (
          <img src={processedSrc} className="w-full h-full object-cover" alt="Preview" />
        ) : (
          <video src={processedSrc} className="w-full h-full object-cover" autoPlay loop muted playsInline />
        )}

        {/* Drawing Canvas */}
        <canvas
          ref={canvasRef}
          width={480}
          height={853} // 9:16 ratio for 480 width
          className={`absolute inset-0 z-20 w-full h-full pointer-events-auto ${isDrawingMode ? 'cursor-crosshair' : 'pointer-events-none'}`}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={endDrawing}
          onMouseLeave={endDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={endDrawing}
        />

        {/* Top Controls Overlay */}
        <div className="absolute top-0 inset-x-0 p-6 flex items-center justify-between z-20">
          <button
            onClick={onCancel}
            className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white hover:bg-black/60 transition-all"
          >
            <X className="w-6 h-6" />
          </button>

          <div className="flex items-center gap-3">
            {paths.length > 0 && (
              <button
                onClick={handleUndo}
                className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white"
              >
                <Undo className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={() => setIsDrawingMode(!isDrawingMode)}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${isDrawingMode ? 'bg-[#DDF639] text-black' : 'bg-black/40 backdrop-blur-md text-white'}`}
            >
              <Pencil className="w-5 h-5" />
            </button>
            {mediaType === "image" && (
              <button
                onClick={() => setIsCropperOpen(true)}
                className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white hover:bg-black/60 transition-all"
                title="Zoom & Crop"
              >
                <Crop className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={() => setShowCaptionInput(!showCaptionInput)}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${showCaptionInput ? 'bg-[#DDF639] text-black' : 'bg-black/40 backdrop-blur-md text-white'}`}
            >
              <Type className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Caption Display Overlay (Simulated Editor) */}
        {!showCaptionInput && caption && (
          <motion.div
            drag
            dragConstraints={{ left: -150, right: 150, top: -350, bottom: 350 }}
            className="absolute z-30 cursor-grab active:cursor-grabbing"
          >
            <div className="bg-black/60 backdrop-blur-xl px-5 py-3 rounded-2xl border border-white/15 shadow-2xl max-w-[280px]">
               <p className="text-white text-[15px] font-black text-center leading-tight drop-shadow-md">{caption}</p>
            </div>
          </motion.div>
        )}

        {/* Text Overlay Editor Interface */}
        <AnimatePresence>
          {showCaptionInput && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm z-40 flex flex-col items-center justify-center p-8"
            >
              <textarea
                autoFocus
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Type your story caption..."
                className="w-full bg-transparent text-white text-2xl font-black text-center placeholder-white/40 outline-none resize-none"
                maxLength={100}
              />
              <button
                onClick={() => setShowCaptionInput(false)}
                className="mt-8 px-6 py-2.5 bg-[#DDF639] text-black rounded-full text-xs font-black uppercase tracking-widest shadow-lg"
              >
                Done
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom Actions Overlay */}
        <div className="absolute bottom-0 inset-x-0 p-8 flex flex-col gap-6 z-20">
          <div className="flex gap-3">
             <button
                onClick={() => setAudience("everyone")}
                className={`flex-1 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-all flex items-center justify-center gap-2 ${audience === 'everyone' ? 'bg-[#DDF639] text-black border-[#DDF639]' : 'bg-black/40 text-white/60 border-white/10'}`}
             >
                <Globe className="w-3.5 h-3.5" />
                Everyone
             </button>
             <button
                onClick={() => setAudience("followers")}
                className={`flex-1 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-all flex items-center justify-center gap-2 ${audience === 'followers' ? 'bg-[#DDF639] text-black border-[#DDF639]' : 'bg-black/40 text-white/60 border-white/10'}`}
             >
                <Users className="w-3.5 h-3.5" />
                Followers
             </button>
          </div>

          <button
            onClick={handlePublish}
            className="w-full h-14 bg-[#DDF639] text-black rounded-full text-sm font-black uppercase tracking-[0.2em] flex items-center justify-center gap-3 shadow-[0_0_30px_rgba(221,246,57,0.3)] active:scale-95 transition-all"
          >
            <span>Your Story</span>
            <Send className="w-5 h-5 fill-current" />
          </button>
        </div>

        {/* Side Gradient for Depth */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40 pointer-events-none" />
      </div>

      {/* Image Cropper Integration */}
      <ImageCropperModal
        isOpen={isCropperOpen}
        imageSrc={mediaSrc}
        cropType="story"
        onCancel={() => setIsCropperOpen(false)}
        onSave={handleCropSave}
      />
    </div>
  );
}
