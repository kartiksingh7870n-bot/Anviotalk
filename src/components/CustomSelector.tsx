import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Check, Search, ChevronDown, X } from "lucide-react";

interface Option {
  value: string;
  label: string;
}

interface CustomSelectorProps {
  id?: string;
  label: string;
  value: string;
  options: (Option | string)[];
  onChange: (value: string) => void;
  searchable?: boolean;
  placeholder?: string;
}

export default function CustomSelector({
  id,
  label,
  value,
  options,
  onChange,
  searchable = false,
  placeholder = "Select an option",
}: CustomSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const normalizedOptions: Option[] = options.map((opt) => {
    if (typeof opt === "string") {
      return { value: opt, label: opt };
    }
    return opt;
  });

  const selectedOption = normalizedOptions.find((opt) => opt.value === value);

  const filteredOptions = normalizedOptions.filter((opt) =>
    opt.label.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative w-full text-left" ref={containerRef} id={id}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full h-11 bg-[#141414] border border-[#2A2A2A] rounded-xl px-4 flex items-center justify-between text-xs font-semibold text-white focus:border-[#E5FF3B] outline-none transition-all hover:bg-[#1E1E1E] cursor-pointer"
      >
        <span className={selectedOption ? "text-white" : "text-[#A1A1AA] font-medium"}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown className={`w-4 h-4 text-[#A1A1AA] transition-transform duration-200 ${isOpen ? "rotate-180 text-[#E5FF3B]" : ""}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            {/* Desktop Popover / Mobile Bottom Sheet overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 bg-black/60 z-40 md:hidden"
            />

            <motion.div
              initial={{ opacity: 0, y: 15, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="absolute md:absolute fixed md:top-full md:bottom-auto bottom-0 left-0 right-0 md:mt-2 bg-[#141414] rounded-t-3xl md:rounded-2xl border border-[#2A2A2A] shadow-2xl z-50 overflow-hidden max-h-[350px] flex flex-col w-full text-white"
            >
              {/* Header for Mobile Drawer */}
              <div className="flex justify-between items-center px-5 py-4 border-b border-[#2A2A2A] md:hidden">
                <span className="text-[11px] font-black uppercase tracking-widest text-[#E5FF3B]">{label}</span>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="p-1 text-[#A1A1AA] hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Search Bar */}
              {searchable && (
                <div className="p-3 border-b border-[#2A2A2A] sticky top-0 bg-[#141414] z-10">
                  <div className="relative flex items-center">
                    <Search className="absolute left-3 w-3.5 h-3.5 text-[#A1A1AA]" />
                    <input
                      type="text"
                      placeholder="Search..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full h-9 pl-9 pr-4 bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg text-xs font-medium text-white outline-none focus:border-[#E5FF3B] placeholder-zinc-600"
                    />
                  </div>
                </div>
              )}

              {/* Options list */}
              <div className="flex-1 overflow-y-auto py-2 custom-scrollbar max-h-[220px]">
                {filteredOptions.length > 0 ? (
                  filteredOptions.map((opt) => {
                    const isSelected = opt.value === value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          onChange(opt.value);
                          setIsOpen(false);
                        }}
                        className={`w-full px-5 py-3 text-left text-xs font-semibold transition-all flex items-center justify-between cursor-pointer ${
                          isSelected
                            ? "bg-[#E5FF3B]/10 text-[#E5FF3B]"
                            : "text-[#A1A1AA] hover:bg-[#1E1E1E] hover:text-white"
                        }`}
                      >
                        <span>{opt.label}</span>
                        {isSelected && <Check className="w-4 h-4 text-[#E5FF3B]" />}
                      </button>
                    );
                  })
                ) : (
                  <div className="px-5 py-4 text-center text-xs text-[#A1A1AA] font-medium">
                    No options found
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
