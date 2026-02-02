import React from 'react';

interface InfoIconProps {
  title: string;
}

export const InfoIcon: React.FC<InfoIconProps> = ({ title }) => {
  return (
    <div 
      className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-500 text-white text-[10px] font-bold cursor-help ml-1 align-middle"
      title={title}
    >
      i
    </div>
  );
};
