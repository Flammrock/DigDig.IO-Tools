import React, { forwardRef } from 'react'
import { PixiComponent, useApp } from '@pixi/react'
import { Viewport as InternalViewport } from 'pixi-viewport'
import { Application } from 'pixi.js'

interface ViewportProps {
  app: Application
  options?: Partial<ViewportOptions>
  children?: React.ReactNode
}

export interface ViewportOptions {
  screenWidth: number
  screenHeight: number
  worldWidth: number
  worldHeight: number
}

const PixiViewportComponent = PixiComponent<ViewportProps, InternalViewport>('Viewport', {
  create(props) {
    const { app, ...viewportProps } = props

    const viewport = new InternalViewport({
      screenWidth: app.screen.width,
      screenHeight: app.screen.height,
      worldWidth: 1000,
      worldHeight: 1000,
      events: app.renderer.events,
      ...viewportProps.options
    })

    // activate plugins
    viewport
      .drag({ mouseButtons: 'left' }) // Allow panning with the left mouse button
      .pinch() // Enable pinch-to-zoom on touch devices
      .wheel() // Enable zooming with the mouse wheel

    viewport.moveCenter(0, 0)

    return viewport
  },
  applyProps(viewport, _oldProps, _newProps) {
    const oldOpts = (_oldProps as ViewportProps).options ?? {}
    const newOpts = (_newProps as ViewportProps).options ?? {}
    if (oldOpts.screenWidth !== newOpts.screenWidth || oldOpts.screenHeight !== newOpts.screenHeight) {
      viewport.resize(newOpts.screenWidth, newOpts.screenHeight)
    }

    if (oldOpts.worldWidth !== newOpts.worldWidth || oldOpts.worldHeight !== newOpts.worldHeight) {
      viewport.worldWidth = newOpts.worldWidth ?? 0
      viewport.worldHeight = newOpts.worldHeight ?? 0
    }
  }
})

// create a component that can be consumed
// that automatically pass down the app
const Viewport = forwardRef<InternalViewport, Omit<ViewportProps, 'app'>>((props, ref) => (
  <PixiViewportComponent ref={ref} app={useApp()} {...props} />
))

Viewport.displayName = 'PixiViewport'

export default Viewport

/*
console.clear();

const { useState, useEffect, useMemo, useCallback, useRef, forwardRef } = React;
const { Stage, Container, Sprite, PixiComponent, useApp, useTick } = ReactPixi;
const { Texture } = PIXI;

PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.NEAREST;

const width = 500;
const height = 500;

const stageOptions = {
  antialias: true,
  autoDensity: true,
  backgroundAlpha: 0
};

const areas = {
  'world': [1000, 1000, 2000, 2000],
  'center': [1000, 1000, 400, 400],
  'tl': [100, 100, 200, 200],
  'tr': [1900, 100, 200, 200],
  'bl': [100, 1900, 200, 200],
  'br': [1900, 1900, 200, 200]
};

useIteration = (incr = 0.1) => {
  const [i, setI] = React.useState(0);

  useTick((delta) => {
    setI(i => i + incr * delta);
  });

  return i;
};

// create and instantiate the viewport component
// we share the ticker and interaction from app
const PixiViewportComponent = PixiComponent("Viewport", {
  create(props) {
    const { app, ...viewportProps } = props;

    const viewport = new Viewport.Viewport({
      ticker: props.app.ticker,
      interaction: props.app.renderer.plugins.interaction,
      ...viewportProps
    });

    // activate plugins
    (props.plugins || []).forEach((plugin) => {
      viewport[plugin]();
    });

    return viewport;
  },
  applyProps(viewport, _oldProps, _newProps) {
    const { plugins: oldPlugins, children: oldChildren, ...oldProps } = _oldProps;
    const { plugins: newPlugins, children: newChildren, ...newProps } = _newProps;

    Object.keys(newProps).forEach((p) => {
      if (oldProps[p] !== newProps[p]) {
        viewport[p] = newProps[p];
      }
    });
  },
  didMount() {
    console.log("viewport mounted");
  }
});

// create a component that can be consumed
// that automatically pass down the app
const PixiViewport = forwardRef((props, ref) => (
  <PixiViewportComponent ref={ref} app={useApp()} {...props} />
));

PixiViewport.displayName = 'PixiViewport';

// Wiggling bunny
const Bunny = forwardRef((props, ref) => {
  // abstracted away, see settings>js
  const i = useIteration(0.1);

  return (
    <Sprite
      ref={ref}
      image="https://s3-us-west-2.amazonaws.com/s.cdpn.io/693612/IaUrttj.png"
      anchor={0.5}
      scale={2}
      rotation={Math.cos(i) * 0.98}
      {...props}
    />
  );
});

Bunny.displayName = 'Bunny';

// 4 squared bunnies
// positioned by its name
const BunniesContainer = ({ name, ...props }) => {
  const [x, y] = areas[name];

  return (
    <Container x={x} y={y} {...props}>
      <Bunny x={-50} y={-50} />
      <Bunny x={50} y={-50} />
      <Bunny x={-50} y={50} />
      <Bunny x={50} y={50} />
    </Container>
  );
}

const BunnyFollowingCircle = forwardRef(({x, y, rad}, ref) => {
  const i = useIteration(0.02);
  return <Bunny ref={ref} x={x + Math.cos(i) * rad} y={y + Math.sin(i) * rad} scale={6} />
});

// the main app
const App = () => {
  // get the actual viewport instance
  const viewportRef = useRef();

  // get ref of the bunny to follow
  const followBunny = useRef();

  // interact with viewport directly
  // move and zoom to specified area
  const focus = useCallback((p) => {
    const viewport = viewportRef.current;
    const [x, y, width, height] = areas[p];

    // pause following
    viewport.plugins.pause('follow');

    // and snap to selected
    viewport.snapZoom({ width, height, removeOnComplete: true });
    viewport.snap(x, y, { removeOnComplete: true });
  }, []);

  const follow = useCallback(() => {
    const viewport = viewportRef.current;

    viewport.snapZoom({ width: 1000, height: 1000 });
    viewport.follow(followBunny.current, { speed: 20 });
  }, []);

  return (
    <>
      <div class="buttons-group">
        <button onClick={() => focus('world')}>Fit</button>
        <button onClick={() => focus('center')}>Center</button>
        <button onClick={() => focus('tl')}>TL</button>
        <button onClick={() => focus('tr')}>TR</button>
        <button onClick={() => focus('bl')}>BL</button>
        <button onClick={() => focus('br')}>BR</button>

        <button onClick={() => follow()}>Follow</button>
      </div>

      <Stage width={width} height={height} options={stageOptions}>
        <PixiViewport
          ref={viewportRef}
          plugins={["drag", "pinch", "wheel", "decelerate"]}
          screenWidth={width}
          screenHeight={height}
          worldWidth={2000}
          worldHeight={2000}
        >
          <BunniesContainer name="tl" />
          <BunniesContainer name="tr" />
          <BunniesContainer name="bl" />
          <BunniesContainer name="br" />
          <BunniesContainer name="center" scale={2} />

          <BunnyFollowingCircle x={1000} y={1000} rad={500} ref={followBunny} />
        </PixiViewport>
      </Stage>
    </>
  );
};

ReactDOM.render(<App />, document.getElementById("root"));*/

/*
export interface ViewportOptions {
  screenWidth: number
  screenHeight: number
  worldWidth: number
  worldHeight: number
  events: EventSystem
}

interface ViewportProps {
  options?: Partial<ViewportOptions>
  children?: React.ReactNode
}

const Viewport = PixiComponent<ViewportProps, ViewportInternal>('Viewport', {
  create: (props) => {
    const { screenWidth, screenHeight, worldWidth, worldHeight, events } = props

    const options: ViewportOptions = props.options ?? {
      events: app
    }

    const viewport = new ViewportInternal({
      screenWidth,
      screenHeight,
      worldWidth,
      worldHeight,
      events
    })

    viewport
      .drag({ mouseButtons: 'right' }) // Allow panning with the right mouse button
      .pinch() // Enable pinch-to-zoom on touch devices
      .wheel() // Enable zooming with the mouse wheel
      .decelerate() // Adds inertia to the drag

    return viewport
  },

  applyProps: (viewport, oldProps, newProps) => {
    const _oldProps = oldProps as ViewportProps
    if (_oldProps.events !== newProps.events) {
      viewport = new ViewportInternal({
        screenWidth: newProps.screenWidth,
        screenHeight: newProps.screenHeight,
        worldWidth: newProps.worldWidth,
        worldHeight: newProps.worldHeight,
        events: newProps.events
      })
      // TODO: replace same zoom translate rotate...
    } else {
      if (_oldProps.screenWidth !== newProps.screenWidth || _oldProps.screenHeight !== newProps.screenHeight) {
        viewport.resize(newProps.screenWidth, newProps.screenHeight)
      }

      if (_oldProps.worldWidth !== newProps.worldWidth || _oldProps.worldHeight !== newProps.worldHeight) {
        viewport.worldWidth = newProps.worldWidth
        viewport.worldHeight = newProps.worldHeight
      }
    }
  },

  willUnmount: (viewport) => {
    viewport.destroy()
  }
})

export default Viewport
*/
/*
interface ViewportComponentProps {
  options?: Partial<ViewportOptions>
  children?: React.ReactNode // Children to be rendered inside the viewport
}

export interface ViewportOptions {
  screenWidth: number
  screenHeight: number
  worldWidth: number
  worldHeight: number
  events: EventSystem
}

const Viewport: React.FC<ViewportComponentProps> = ({ options = {}, children }) => {
  const viewportRef = useRef<Nullable<ViewportInternal>>(null)
  const app = useApp() // Use the PixiJS application instance from react-pixi

  useEffect(() => {
    if (!viewportRef.current) {
      // Initialize the viewport
      const viewport = new ViewportInternal({
        screenWidth: app.screen.width,
        screenHeight: app.screen.height,
        worldWidth: app.screen.width * 2,
        worldHeight: app.screen.height * 2,
        events: app.renderer.events,
        ...options // Spread additional options
      })

      viewport
        .drag({ mouseButtons: 'right' }) // Allow panning with the right mouse button
        .pinch() // Enable pinch-to-zoom on touch devices
        .wheel() // Enable zooming with the mouse wheel
        .decelerate() // Adds inertia to the drag

      // Add the viewport to the stage
      app.stage.addChild(viewport)

      // Store the viewport instance in the ref
      viewportRef.current = viewport
    }

    // Clean up on unmount
    return () => {
      if (viewportRef.current) {
        app.stage.removeChild(viewportRef.current)
        viewportRef.current.destroy()
        viewportRef.current = null
      }
    }
  }, [app, options])

  return (
    <>
      {viewportRef.current && (
        <Container>
          {React.Children.map(children, (child) =>
            React.cloneElement(child as React.ReactElement, {
              parent: viewportRef.current
            })
          )}
        </Container>
      )}
    </>
  )
}

export default Viewport
*/
