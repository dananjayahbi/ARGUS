"use client";

import { useEffect, useState } from "react";

interface LoadedImageState {
  url: string | null;
  image: HTMLImageElement | null;
  error: string | null;
}

export function useLoadedImage(url: string | null) {
  const [state, setState] = useState<LoadedImageState>({
    url: null,
    image: null,
    error: null,
  });

  useEffect(() => {
    if (!url) {
      return;
    }

    let cancelled = false;
    const element = new window.Image();
    element.crossOrigin = "anonymous";
    element.onload = () => {
      if (!cancelled) {
        setState({ url, image: element, error: null });
      }
    };
    element.onerror = () => {
      if (!cancelled) {
        setState({
          url,
          image: null,
          error: "Unable to load the image.",
        });
      }
    };
    element.src = url;

    return () => {
      cancelled = true;
      element.onload = null;
      element.onerror = null;
    };
  }, [url]);

  if (state.url !== url) {
    return { image: null, error: null };
  }

  return { image: state.image, error: state.error };
}
