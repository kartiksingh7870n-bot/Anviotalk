import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { RotateCw, RefreshCw, Check, X, Camera, Image as ImageIcon, Crop } from "lucide-react";

interface ImageCropperModalProps {
  isOpen: boolean;
  imageSrc: string;
  cropType: "circle" | "square" | "cover" | "story";
  onCancel: () => void;
  onSave: (croppedBase64: string, caption?: string) => void;
  showCaptionInput?: boolean;
}

export default function ImageCropperModal({
  isOpen,
  imageSrc,
  cropType,
  onCancel,
  onSave,
  showCaptionInput = false,
}: ImageCropperModalProps) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isCropping, setIsCropping] = useState(false);
  const [caption, setCaption] = useState("");

  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const positionStartRef = useRef({ x: 0, y: 0 });
  const touchStateRef = useRef({ 
    distance: 0, 
    angle: 0, 
    startZoom: 1, 
    startRotation: 0,
    isRotating: false,
    isZooming: false
  });

  const hasChanges = zoom !== 1 || rotation !== 0 || position.x !== 0 || position.y !== 0 || caption !== "";

  const handleCancelAttempt = () => {
    if (hasChanges) {
      setShowDiscardConfirm(true);
    } else {
      onCancel();
    }
  };

  // Reset parameters when image changes or modal opens
  useEffect(() => {
    if (isOpen) {
      setZoom(1);
      setRotation(0);
      setPosition({ x: 0, y: 0 });
      setCaption("");
      setShowDiscardConfirm(false);
    }
  }, [isOpen, imageSrc]);

  if (!isOpen) return null;

  // Handle Drag / Reposition
  const handleStart = (clientX: number, clientY: number) => {
    setIsDragging(true);
    dragStartRef.current = { x: clientX, y: clientY };
    positionStartRef.current = { ...position };
  };

  const handleMove = (clientX: number, clientY: number) => {
    if (!isDragging) return;
    const dx = clientX - dragStartRef.current.x;
    const dy = clientY - dragStartRef.current.y;
    setPosition({
      x: positionStartRef.current.x + dx,
      y: positionStartRef.current.y + dy,
    });
  };

  const handleEnd = () => {
    setIsDragging(false);
  };

  // Touch handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      handleStart(e.touches[0].clientX, e.touches[0].clientY);
    } else if (e.touches.length === 2) {
      setIsDragging(false); // Cancel single-finger drag
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dx = t2.clientX - t1.clientX;
      const dy = t2.clientY - t1.clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      
      touchStateRef.current = {
        distance,
        angle,
        startZoom: zoom,
        startRotation: rotation,
        isRotating: false,
        isZooming: false
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      handleMove(e.touches[0].clientX, e.touches[0].clientY);
    } else if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dx = t2.clientX - t1.clientX;
      const dy = t2.clientY - t1.clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);

      if (touchStateRef.current.distance > 0) {
        // Calculate raw differences relative to gesture start
        let angleDiff = angle - touchStateRef.current.angle;
        while (angleDiff > 180) angleDiff -= 360;
        while (angleDiff < -180) angleDiff += 360;

        const absAngleDiff = Math.abs(angleDiff);
        const ratioDiff = Math.abs(distance - touchStateRef.current.distance) / touchStateRef.current.distance;

        // Determine intentionality with a dead-zone/threshold to prevent unwanted cross-talk
        if (!touchStateRef.current.isRotating && absAngleDiff > 4) {
          touchStateRef.current.isRotating = true;
        }
        if (!touchStateRef.current.isZooming && ratioDiff > 0.05) {
          touchStateRef.current.isZooming = true;
        }

        // Only apply zoom if we crossed the zoom threshold
        if (touchStateRef.current.isZooming) {
          const factor = distance / touchStateRef.current.distance;
          const newZoom = Math.min(4, Math.max(1, touchStateRef.current.startZoom * factor));
          setZoom(newZoom);
        }

        // Only apply rotation if we crossed the rotation threshold
        if (touchStateRef.current.isRotating) {
          let newRotation = (touchStateRef.current.startRotation + angleDiff) % 360;
          if (newRotation < 0) newRotation += 360;
          setRotation(newRotation);
        }
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length === 0) {
      handleEnd();
    } else if (e.touches.length === 1) {
      // Transition back to single-finger drag gracefully
      handleStart(e.touches[0].clientX, e.touches[0].clientY);
    }
  };

  // Mouse wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomStep = 0.05;
    const direction = e.deltaY < 0 ? 1 : -1;
    setZoom((prev) => Math.min(4, Math.max(1, prev + direction * zoomStep)));
  };

  // Mouse handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    handleStart(e.clientX, e.clientY);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    handleMove(e.clientX, e.clientY);
  };

  // Reset to defaults
  const handleReset = () => {
    setZoom(1);
    setRotation(0);
    setPosition({ x: 0, y: 0 });
  };

  // Rotate in 90deg steps
  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  // Perform the actual crop operation on a Canvas
  const handleCropSave = async () => {
    if (!imageRef.current || !containerRef.current) return;
    setIsCropping(true);

    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = imageSrc;

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not create canvas context");

      // Define target output size based on type - Optimized for extreme speed, low payload size and Firestore storage compatibility
      let outputWidth = 320;
      let outputHeight = 320;
      if (cropType === "cover") {
        outputWidth = 600;
        outputHeight = 240; // 2.5:1 ratio
      } else if (cropType === "story") {
        outputWidth = 540;
        outputHeight = 960; // 9:16 ratio
      }

      canvas.width = outputWidth;
      canvas.height = outputHeight;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "medium";

      // Clear with transparent/white background
      ctx.clearRect(0, 0, outputWidth, outputHeight);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, outputWidth, outputHeight);

      // Move canvas origin to the center for rotation & scaling
      ctx.translate(outputWidth / 2, outputHeight / 2);
      ctx.rotate((rotation * Math.PI) / 180);

      // We need to map the onscreen dragging & zoom to the original image dimensions.
      // Get the display sizes:
      const imgEl = imageRef.current;
      const containerEl = containerRef.current;

      const displayWidth = imgEl.offsetWidth;
      const displayHeight = imgEl.offsetHeight;

      // Crop window bounds in display units:
      let cropWinWidth = 240;
      let cropWinHeight = 240;
      if (cropType === "cover") {
        cropWinWidth = 280;
        cropWinHeight = 112; // 2.5:1
      } else if (cropType === "story") {
        cropWinWidth = 200;
        cropWinHeight = 356; // 9:16 ratio approximately (200 / 9 * 16 = 355.5)
      }

      // Calculate the scaling factor from display units to output units
      const scaleX = outputWidth / cropWinWidth;
      const scaleY = outputHeight / cropWinHeight;

      // Apply the screen translation and scaling
      // Position is relative to the center of the crop window.
      const drawWidth = displayWidth * zoom * scaleX;
      const drawHeight = displayHeight * zoom * scaleY;

      const drawX = position.x * scaleX;
      const drawY = position.y * scaleY;

      ctx.drawImage(
        img,
        drawX - drawWidth / 2,
        drawY - drawHeight / 2,
        drawWidth,
        drawHeight
      );

      const croppedBase64 = canvas.toDataURL("image/jpeg", 0.5);
      onSave(croppedBase64, caption);
    } catch (err) {
      console.error("Cropping failed:", err);
    } finally {
      setIsCropping(false);
    }
  };

  return (
    <AnimatePresence>
      <div 
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            handleCancelAttempt();
          }
        }}
        className="fixed inset-0 bg-[#1b1c1c]/95 z-[100] flex flex-col justify-between p-6 md:p-10 text-white font-sans overflow-hidden"
      >
        {/* Top Header */}
        <div className="flex justify-between items-center z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#854c6f] flex items-center justify-center shadow-sm">
              <Camera className="w-4 h-4 text-white" />
            </div>
            <div>
              <h4 className="text-sm font-black uppercase tracking-wider text-white">Adjust Presentation</h4>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                {cropType === "circle" ? "Circle Crop" : cropType === "cover" ? "Landscape Cover" : cropType === "story" ? "9:16 Story Crop" : "Square Crop"}
              </p>
            </div>
          </div>
          <button
            onClick={handleCancelAttempt}
            className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Workspace - Crop Box Viewport */}
        <div className="flex-1 flex items-center justify-center relative my-6">
          <div
            ref={containerRef}
            className={`w-full max-w-[320px] bg-[#121313] rounded-3xl relative overflow-hidden flex items-center justify-center border border-white/5 select-none touch-none shadow-2xl ${cropType === 'story' ? 'aspect-[9/16]' : 'aspect-square'}`}
            onMouseMove={handleMouseMove}
            onMouseUp={handleEnd}
            onMouseLeave={handleEnd}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
            onWheel={handleWheel}
          >
            {/* Image display layer */}
            <img
              ref={imageRef}
              src={imageSrc}
              alt="Crop workspace"
              onMouseDown={handleMouseDown}
              className="max-w-full max-h-full object-contain pointer-events-none transition-transform duration-75 select-none"
              style={{
                transform: `translate(${position.x}px, ${position.y}px) scale(${zoom}) rotate(${rotation}deg)`,
                cursor: isDragging ? "grabbing" : "grab",
              }}
            />

            {/* Overlays */}
            {cropType === "circle" && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                {/* Out-of-bounds darkened layer */}
                <div className="absolute inset-0 bg-black/60" style={{ clipPath: "polygon(0% 0%, 0% 100%, 100% 100%, 100% 0%, 0% 0%, 50% 50%, 50% 12%, 50% 88%, 50% 50%, 0% 0%)" }} />
                <div className="w-[240px] h-[240px] rounded-full border-2 border-dashed border-[#fed7e9] shadow-[0_0_0_9999px_rgba(27,28,28,0.7)]" />
              </div>
            )}

            {cropType === "square" && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="w-[240px] h-[240px] border-2 border-dashed border-[#fed7e9] shadow-[0_0_0_9999px_rgba(27,28,28,0.7)]" />
              </div>
            )}

            {cropType === "cover" && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="w-[280px] h-[112px] border-2 border-dashed border-[#fed7e9] shadow-[0_0_0_9999px_rgba(27,28,28,0.7)]" />
              </div>
            )}

            {cropType === "story" && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="w-[200px] h-[356px] border-2 border-dashed border-[#DDF639] shadow-[0_0_0_9999px_rgba(10,10,12,0.8)]" />
                <div className="absolute bottom-10 text-[10px] font-bold text-[#DDF639] bg-black/60 px-3 py-1 rounded-full backdrop-blur-md uppercase tracking-widest">
                  Pinch to Zoom • Drag to Move
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Dynamic Controls Bottom Bar */}
        <div className="space-y-4 max-w-sm mx-auto w-full z-10 bg-[#1b1c1c] p-4 rounded-3xl border border-white/5 shadow-xl">
          {showCaptionInput && (
            <div className="space-y-1.5 px-1">
              <label className="text-[10px] uppercase font-black tracking-widest text-[#feb7df]/80">
                Write a Caption (Optional)
              </label>
              <input
                type="text"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Add a custom caption for your story..."
                className="w-full h-11 px-4 rounded-2xl bg-white/5 border border-white/10 text-xs focus:outline-none focus:border-[#feb7df] transition-colors placeholder-slate-500 text-white"
              />
            </div>
          )}

          {/* Action Row */}
          <div className="flex justify-between items-center gap-3">
            <div className="flex gap-2.5">
              <button
                onClick={handleRotate}
                title="Rotate 90°"
                className="w-11 h-11 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-all cursor-pointer border border-white/5 active:scale-95"
              >
                <RotateCw className="w-4 h-4 text-white" />
              </button>
              <button
                onClick={handleReset}
                title="Reset Workspace"
                className="w-11 h-11 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-all cursor-pointer border border-white/5 active:scale-95"
              >
                <RefreshCw className="w-4 h-4 text-white" />
              </button>
            </div>

            <div className="flex gap-2.5 flex-1 justify-end">
              <button
                onClick={handleCancelAttempt}
                className="px-5 h-11 rounded-full bg-white/5 hover:bg-white/10 text-xs font-black uppercase tracking-wider transition-all cursor-pointer border border-white/5 active:scale-95"
              >
                Cancel
              </button>
              <button
                onClick={handleCropSave}
                disabled={isCropping}
                className="px-6 h-11 rounded-full bg-[#854c6f] hover:bg-[#854c6f]/90 text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 shadow-lg shadow-[#854c6f]/20 disabled:opacity-50"
              >
                {isCropping ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Apply Crop</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Discard changes state-based overlay */}
        {showDiscardConfirm && (
          <div className="absolute inset-0 bg-black/80 z-[110] flex items-center justify-center p-6">
            <div className="bg-[#1b1c1c] border border-white/10 rounded-3xl p-6 max-w-xs w-full text-center shadow-2xl">
              <h5 className="font-bold text-sm mb-2">Discard Changes?</h5>
              <p className="text-xs text-slate-400 mb-5">You have unsaved changes on this image. Are you sure you want to discard them?</p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => setShowDiscardConfirm(false)}
                  className="flex-1 py-2.5 bg-white/10 hover:bg-white/20 rounded-full text-xs font-bold cursor-pointer"
                >
                  Keep Editing
                </button>
                <button
                  onClick={() => {
                    setShowDiscardConfirm(false);
                    onCancel();
                  }}
                  className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 rounded-full text-xs font-bold cursor-pointer"
                >
                  Discard
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AnimatePresence>
  );
}
