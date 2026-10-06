import { useEffect, useRef } from "react";

declare global {
  interface Window {
    /** The loading animation from public/node-cluster.js; returns a function that stops it. */
    rvaNodeCluster?: (canvas: HTMLCanvasElement, options: { size: number; light?: boolean; wire?: string }) => () => void;
  }
}

/**
 * The app's loading animation, the same turning cluster of nodes as the start-up screen,
 * at any size. Its wires take the surrounding text colour, so it fits dark and light
 * panels alike.
 */
export function NodeLoader({ size, className }: { size: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !window.rvaNodeCluster) return;
    const rgb = getComputedStyle(canvas).color.match(/\d+(\.\d+)?/g)?.slice(0, 3).map(Number) ?? [148, 197, 255];
    // Dark text means a light background.
    const light = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 < 0.5;
    return window.rvaNodeCluster(canvas, { size, light, wire: rgb.join(", ") });
  }, [size]);
  return (
    <canvas
      ref={ref}
      className={className ? `node-loader ${className}` : "node-loader"}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}
