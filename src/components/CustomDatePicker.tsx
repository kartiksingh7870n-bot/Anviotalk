import React, { useState, useEffect } from "react";

interface CustomDatePickerProps {
  value: string; // Accepts ISO YYYY-MM-DD or DD/MM/YYYY
  onChange: (value: string) => void;
  error?: boolean;
}

export default function CustomDatePicker({ value, onChange, error }: CustomDatePickerProps) {
  // Convert DD/MM/YYYY to YYYY-MM-DD if needed for native <input type="date">
  const parseToIso = (val: string): string => {
    if (!val) return "2000-01-01";
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
    const match = val.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (match) {
      const day = match[1].padStart(2, '0');
      const month = match[2].padStart(2, '0');
      const year = match[3];
      return `${year}-${month}-${day}`;
    }
    return "2000-01-01";
  };

  const [dateVal, setDateVal] = useState<string>(() => parseToIso(value));
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (value) {
      setDateVal(parseToIso(value));
    } else {
      setDateVal("2000-01-01");
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.value;
    setDateVal(selected);

    if (!selected) {
      setLocalError("Date of birth is required");
      onChange("");
      return;
    }

    const birthDate = new Date(selected);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }

    if (age < 18) {
      setLocalError("You must be at least 18 years old");
      onChange(selected);
    } else {
      setLocalError(null);
      onChange(selected);
    }
  };

  return (
    <div className="flex flex-col w-full">
      <input
        type="date"
        name="anviotalk-dob"
        value={dateVal || "2000-01-01"}
        onChange={handleChange}
        min="1920-01-01"
        max={new Date().toISOString().split("T")[0]}
        style={{ colorScheme: 'dark' }}
        className={`w-full h-12 bg-[#1E1E1E] border text-white rounded-xl px-4 text-sm font-semibold focus:border-[#E5FF3B] outline-none transition-colors cursor-pointer ${
          error || localError ? "border-rose-500 bg-rose-950/20" : "border-[#2A2A2A]"
        }`}
      />
      {localError && (
        <span className="text-[10px] text-rose-400 font-bold mt-1 text-left">
          {localError}
        </span>
      )}
    </div>
  );
}
