import React from 'react';

interface TigiCatProps {
  size?: number;
  className?: string;
}

export function TigiCat({ size = 24, className = '' }: TigiCatProps) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 64 64" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="1" floodOpacity="0.1" />
        </filter>
      </defs>

      {/* Main Face Shape - Soft rounded rectangle/superellipse for a mascot look */}
      <circle cx="32" cy="34" r="22" fill="#E4C585" stroke="#4A4036" strokeWidth="2" />

      {/* Ears - ENLARGED: Tips moved out/up (8,8 & 56,8), Bases widened */}
      <path 
        d="M8 8 C6 18 10 26 16 30 L 26 24 C 20 20 14 6 8 8 Z" 
        fill="#E4C585" 
        stroke="#4A4036" 
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path 
        d="M56 8 C 58 18 54 26 48 30 L 38 24 C 44 20 50 6 56 8 Z" 
        fill="#E4C585" 
        stroke="#4A4036" 
        strokeWidth="2"
        strokeLinejoin="round"
      />
      
      {/* Ear Insides - Enlarged to match */}
      <path d="M12 11 C 11 16 14 22 17 24 L 22 20 C 19 17 15 10 12 11 Z" fill="#EBC7B6" />
      <path d="M52 11 C 53 16 50 22 47 24 L 42 20 C 45 17 49 10 52 11 Z" fill="#EBC7B6" />

      {/* Re-draw Face over ears to hide attachment points */}
      <circle cx="32" cy="34" r="21" fill="#E4C585" />
      <path d="M11 34 A 21 21 0 1 1 53 34" fill="none" stroke="#4A4036" strokeWidth="2" strokeLinecap="round" />
      {/* Jawline/Cheeks fluff */}
      <path 
        d="M11 34 C 11 48 19 56 32 56 C 45 56 53 48 53 34" 
        fill="#E4C585" 
        stroke="#4A4036" 
        strokeWidth="2" 
        strokeLinecap="round"
      />

      {/* Tiger Stripes - Forehead */}
      <path d="M32 16 L 30 24 L 32 22 L 34 24 Z" fill="#4A4036" />
      <path d="M32 16 V 22" stroke="#4A4036" strokeWidth="2" strokeLinecap="round" />
      <path d="M24 18 L 26 24 L 28 23 L 26 18 Z" fill="#4A4036" />
      <path d="M40 18 L 38 24 L 36 23 L 38 18 Z" fill="#4A4036" />

      {/* Tiger Stripes - Cheeks */}
      <path d="M12 36 L 18 36 L 18 38 L 13 39 Z" fill="#4A4036" />
      <path d="M13 41 L 18 40 L 18 42 L 14 43 Z" fill="#4A4036" />
      
      <path d="M52 36 L 46 36 L 46 38 L 51 39 Z" fill="#4A4036" />
      <path d="M51 41 L 46 40 L 46 42 L 50 43 Z" fill="#4A4036" />

      {/* Muzzle Area - White patches */}
      <ellipse cx="25" cy="42" rx="7" ry="6" fill="#FFF8E7" />
      <ellipse cx="39" cy="42" rx="7" ry="6" fill="#FFF8E7" />

      {/* Nose - Pink rounded triangle */}
      <path 
        d="M28 40 Q 32 38 36 40 L 34 43 Q 32 45 30 43 Z" 
        fill="#E99FA0" 
        stroke="#4A4036" 
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      
      {/* Mouth */}
      <path d="M32 44 V 46" stroke="#4A4036" strokeWidth="2" strokeLinecap="round" />
      <path d="M32 46 Q 28 50 24 46" stroke="#4A4036" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M32 46 Q 36 50 40 46" stroke="#4A4036" strokeWidth="2" strokeLinecap="round" fill="none" />
 
      {/* Whiskers - White, extending beyond face */}
      <g stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.9">
        {/* Left Side */}
        <path d="M 20 40 L 4 36" />  {/* Top */}
        <path d="M 20 42 L 2 42" />  {/* Middle */}
        <path d="M 20 44 L 5 48" />  {/* Bottom */}

        {/* Right Side */}
        <path d="M 44 40 L 60 36" /> {/* Top */}
        <path d="M 44 42 L 62 42" /> {/* Middle */}
        <path d="M 44 44 L 59 48" /> {/* Bottom */}
      </g>

      {/* Eyes - Large cute style */}
      <ellipse cx="22" cy="32" rx="4" ry="5" fill="#333" />
      <ellipse cx="42" cy="32" rx="4" ry="5" fill="#333" />
      {/* Highlights */}
      <circle cx="20" cy="30" r="1.5" fill="white" />
      <circle cx="23" cy="33" r="0.8" fill="white" opacity="0.8" />
      <circle cx="44" cy="30" r="1.5" fill="white" />
      <circle cx="41" cy="33" r="0.8" fill="white" opacity="0.8" />

    </svg>
  );
}
