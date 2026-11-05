import React from 'react';

interface AWCLogoProps {
  size?: number;
  className?: string;
  src?: string;
}

export const AWCLogo: React.FC<AWCLogoProps> = ({
  size = 120,
  className = '',
  src = '/awc_connect_logo.png',
}) => (
  <img
    src={src}
    alt="PLCC Chat — Promised Land Christian Center"
    width={size}
    height={size}
    className={`object-contain ${className}`}
  />
);
