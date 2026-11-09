"use client";
import Image from "next/image";
import { Play } from "lucide-react";
import { useState } from "react";

const VIDEO_ID = "0Tv0MdWdJRw";
const TITLE = "What is Tempo?";
const WATCH_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;

/**
 * The "What is Tempo?" video. Nothing from YouTube loads until someone presses play: the poster is our own copy of the
 * thumbnail (public/tempo-video-poster.jpg), and the player is YouTube's no-cookie embed, created on click. So the page stays
 * fast and no visitor data goes to YouTube just for viewing the home page.
 */
export function VideoShowcase() {
  const [playing, setPlaying] = useState(false);

  return (
    <section aria-labelledby="video-title" className="animate-rise mx-auto mt-12 max-w-3xl sm:mt-14" style={{ animationDelay: "240ms" }}>
      <h2 id="video-title" className="text-balance text-[22px] font-bold tracking-[-0.02em] sm:text-[26px]">See how Tempo works</h2>
      <div className="mt-4 rounded-[22px] glass-strong hairline p-1.5 shadow-lg sm:rounded-[26px] sm:p-2">
        <div className="relative aspect-video overflow-hidden rounded-[18px] bg-black sm:rounded-[20px]">
          {playing ? (
            <iframe
              className="absolute inset-0 size-full"
              src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&rel=0&playsinline=1`}
              title={TITLE}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : (
            <button
              type="button"
              onClick={() => setPlaying(true)}
              aria-label={`Play video: ${TITLE}`}
              className="group absolute inset-0 grid size-full place-items-center focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-white"
            >
              <Image src="/tempo-video-poster.jpg" alt="" fill sizes="(min-width: 768px) 720px, 100vw" className="object-cover" />
              <span aria-hidden className="absolute inset-0 bg-black/25 transition group-hover:bg-black/15" />
              <span aria-hidden className="relative grid size-16 place-items-center rounded-full bg-white/95 text-[#0062E0] shadow-lg transition group-hover:scale-105 sm:size-20">
                <Play className="ml-1 size-7 sm:size-9" fill="currentColor" strokeWidth={0} />
              </span>
            </button>
          )}
        </div>
      </div>
      <p className="mt-3 text-base text-label-2">
        <a href={WATCH_URL} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-medium text-accent-text underline">Watch on YouTube</a>
      </p>
    </section>
  );
}
