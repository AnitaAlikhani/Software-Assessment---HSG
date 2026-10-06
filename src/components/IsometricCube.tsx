import React from 'react';

interface IsometricCubeProps {
  className?: string;
  size?: number;
}

export const IsometricCube: React.FC<IsometricCubeProps> = ({
  className = 'w-64 h-64',
  size = 240,
}) => {
  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      {/* Soft circular aura background matching Figma */}
      <div className="absolute w-52 h-52 sm:w-60 sm:h-60 rounded-full bg-gradient-to-tr from-purple-100/80 via-indigo-50/90 to-blue-50/70 blur-xl pointer-events-none" />
      <div className="absolute w-44 h-44 sm:w-52 sm:h-52 rounded-full bg-slate-100/80 pointer-events-none" />

      {/* SVG 3D Isometric Cube */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 200 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="relative z-10 drop-shadow-[0_16px_24px_rgba(79,70,229,0.18)]"
      >
        <defs>
          {/* Top face gradient */}
          <linearGradient id="cubeTop" x1="100" y1="35" x2="100" y2="95" gradientUnits="userSpaceOnUse">
            <stop stopColor="#9B8EF8" />
            <stop offset="1" stopColor="#8072E8" />
          </linearGradient>

          {/* Left face gradient */}
          <linearGradient id="cubeLeft" x1="45" y1="95" x2="100" y2="165" gradientUnits="userSpaceOnUse">
            <stop stopColor="#5544E6" />
            <stop offset="1" stopColor="#4333CF" />
          </linearGradient>

          {/* Right face gradient */}
          <linearGradient id="cubeRight" x1="155" y1="95" x2="100" y2="165" gradientUnits="userSpaceOnUse">
            <stop stopColor="#A89CFB" />
            <stop offset="1" stopColor="#9384F3" />
          </linearGradient>

          {/* Ground shadow ellipse */}
          <radialGradient id="cubeShadow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#4338CA" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#4338CA" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Soft shadow under the cube */}
        <ellipse cx="100" cy="172" rx="55" ry="14" fill="url(#cubeShadow)" />

        {/* Left Face */}
        <polygon
          points="46,72 100,103 100,165 46,134"
          fill="url(#cubeLeft)"
        />

        {/* Right Face */}
        <polygon
          points="100,103 154,72 154,134 100,165"
          fill="url(#cubeRight)"
        />

        {/* Top Face */}
        <polygon
          points="100,41 154,72 100,103 46,72"
          fill="url(#cubeTop)"
        />

        {/* Subtle interior edge highlight */}
        <line x1="100" y1="103" x2="100" y2="165" stroke="#FFFFFF" strokeOpacity="0.18" strokeWidth="1" />
        <line x1="46" y1="72" x2="100" y2="103" stroke="#FFFFFF" strokeOpacity="0.2" strokeWidth="1" />
        <line x1="100" y1="103" x2="154" y2="72" stroke="#FFFFFF" strokeOpacity="0.2" strokeWidth="1" />
      </svg>
    </div>
  );
};
