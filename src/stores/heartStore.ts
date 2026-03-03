import { create } from 'zustand';

export interface HeartData {
  id: number;
  x: number; // relative 0-1 (percentage of width)
  y: number; // relative 0-1 (percentage of height)
  color: string;
  tx: number;
}

interface HeartStore {
  // Store the last triggered heart event to be consumed by listeners
  outgoingHeart: HeartData | null;
  incomingHeart: HeartData | null;
  
  // Actions
  triggerHeart: (heart: HeartData) => void; // Trigger a local heart (to be sent)
  receiveHeart: (heart: HeartData) => void; // Receive a remote heart (to be shown)
}

export const useHeartStore = create<HeartStore>((set) => ({
  outgoingHeart: null,
  incomingHeart: null,
  triggerHeart: (heart) => set({ outgoingHeart: heart }),
  receiveHeart: (heart) => set({ incomingHeart: heart }),
}));
