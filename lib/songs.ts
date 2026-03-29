export type Soundtrack = {
  id: string;
  name: string;
  description: string;
  src: string;
};

export const SOUNDTRACKS: Soundtrack[] = [
  {
    id: "beat-drops",
    name: "Beat Drops",
    description: "High-energy drops to test telemetry capture + beat-driven visuals.",
    src: "/songs/beat-drops.mp3"
  },
  {
    id: "shamsien",
    name: "Shamsien",
    description: "Explosive, energetic rock groove.",
    src: "/songs/shamsien.mp3"
  },
  {
    id: "simple-rap-beat",
    name: "Simple Rap Beat, Hip Hop Instrumental, Freestyle Beat",
    description: "Simple beat for testing gesture-controlled modulation of the music.",
    src: "/songs/simple-rap-beat.mp3"
  }
];
