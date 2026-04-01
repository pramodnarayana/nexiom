declare module '@formkit/auto-animate/react' {
  import * as React from 'react';

  export interface AutoAnimateOptions {
    duration?: number;
    easing?: string;
    disrespectUserMotionPreference?: boolean;
    // other auto-animate options can go here
  }

  export function useAutoAnimate<T extends Element>(
    options?: AutoAnimateOptions | ((el: Element, action: 'add' | 'remove' | 'remain', oldCoords?: unknown, newCoords?: unknown) => unknown)
  ): [React.RefObject<T> | React.MutableRefObject<T> | React.RefCallback<T>, (enabled: boolean) => void];
}
