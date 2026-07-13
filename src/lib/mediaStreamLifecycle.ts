export interface StoppableMediaStream {
  getTracks(): ReadonlyArray<{ stop(): void }>;
}

export interface MediaStreamLifecycle<T extends StoppableMediaStream> {
  beginRequest(): number;
  isCurrent(requestGeneration: number): boolean;
  commit(requestGeneration: number, stream: T): boolean;
  current(): T | null;
  cleanup(): void;
}

function stopStream(stream: StoppableMediaStream | null) {
  stream?.getTracks().forEach(track => track.stop());
}

export function createMediaStreamLifecycle<
  T extends StoppableMediaStream,
>(): MediaStreamLifecycle<T> {
  let generation = 0;
  let currentStream: T | null = null;

  return {
    beginRequest() {
      generation += 1;
      return generation;
    },

    isCurrent(requestGeneration) {
      return requestGeneration === generation;
    },

    commit(requestGeneration, stream) {
      if (requestGeneration !== generation) {
        stopStream(stream);
        return false;
      }

      const previousStream = currentStream;
      currentStream = stream;

      if (previousStream !== stream) {
        stopStream(previousStream);
      }

      return true;
    },

    current() {
      return currentStream;
    },

    cleanup() {
      generation += 1;
      const stream = currentStream;
      currentStream = null;
      stopStream(stream);
    },
  };
}
