import { useAtomValue } from "@effect/atom-react";
import type { LegendListRef } from "@legendapp/list/react-native";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Animated,
  View,
  type ViewInstance,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnUI } from "react-native-reanimated";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { pendingThreadOrderAtom, threadDropBusyAtom } from "../../state/thread-order";
import type { ThreadMoveDestination } from "./threadOrder";
import { threadListDragDestination, threadListDragScrollSpeed } from "./thread-list-drag-geometry";

type Row = {
  thread: EnvironmentThreadShell;
  section: "pinned" | "active";
  enabled: boolean;
  view: ViewInstance;
};
type MeasuredRow = Row & { key: string; top: number; left: number; width: number; height: number };
type Drag = {
  row: MeasuredRow;
  y: number;
  destination: ReturnType<typeof threadListDragDestination>;
};

/** The gesture lives above the recycler so scrolling its source offscreen cannot end a drag. */
export function useThreadListDrag(input: {
  listRef: RefObject<LegendListRef | null>;
  orderVersion: string;
  handleInset: number;
  onMove: (thread: EnvironmentThreadShell, destination: ThreadMoveDestination) => Promise<boolean>;
  onStart: () => void;
}) {
  const pending = useAtomValue(pendingThreadOrderAtom);
  const busy = useAtomValue(threadDropBusyAtom);
  const disabled = pending !== null || busy;
  const latest = useRef({ ...input, disabled });
  useLayoutEffect(() => {
    latest.current = { ...input, disabled };
  });
  const viewport = useRef<ViewInstance>(null);
  const bounds = useRef({ top: 0, width: 0, height: 0, offset: 0, minimum: 0, maximum: 0 });
  const rows = useRef(new Map<string, Row>());
  const measured = useRef(new Map<string, MeasuredRow>());
  const drag = useRef<Drag | null>(null);
  const generation = useRef(0);
  const frame = useRef<number | null>(null);
  const [translation] = useState(() => new Animated.Value(0));
  const [preview, setPreview] = useState<{
    key: string;
    title: string;
    destination: Drag["destination"];
  } | null>(null);

  const stop = useCallback(() => {
    generation.current += 1;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    drag.current = null;
    measured.current.clear();
    setPreview(null);
  }, []);
  useEffect(() => stop(), [input.orderVersion, disabled, stop]);
  useEffect(
    () => () => {
      generation.current += 1;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const measure = useCallback((key: string, row: Row, done?: () => void) => {
    const version = generation.current;
    row.view.measureInWindow((left, top, width, height) => {
      if (version === generation.current && rows.current.get(key) === row && height > 0) {
        measured.current.set(key, {
          ...row,
          key,
          left,
          top: top + bounds.current.offset,
          width,
          height,
        });
      }
      done?.();
    });
  }, []);
  const register = useCallback(
    (key: string, row: Row) => {
      rows.current.set(key, row);
      if (drag.current) measure(key, row);
      return () => {
        if (rows.current.get(key) !== row) return;
        rows.current.delete(key);
        measured.current.delete(key);
      };
    },
    [measure],
  );
  const update = useCallback(
    (y: number) => {
      const current = drag.current;
      if (!current) return;
      current.y = y;
      const { top, height, offset } = bounds.current;
      translation.setValue(Math.max(0, Math.min(height - 48, y - top - 24)));
      const destination =
        y >= top && y <= top + height
          ? threadListDragDestination([...measured.current.values()], current.row, y + offset)
          : null;
      if (
        current.destination?.targetId !== destination?.targetId ||
        current.destination?.placement !== destination?.placement
      ) {
        current.destination = destination;
        setPreview({ key: current.row.key, title: current.row.thread.title, destination });
      }
    },
    [translation],
  );

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .manualActivation(true)
        .runOnJS(true)
        .onTouchesDown((event, manager) => {
          const touch = event.allTouches[0];
          if (drag.current) {
            stop();
            runOnUI(manager.end)();
            return;
          }
          if (
            !touch ||
            event.numberOfTouches !== 1 ||
            latest.current.disabled ||
            touch.x < bounds.current.width - latest.current.handleInset - 44
          ) {
            generation.current += 1;
            runOnUI(manager.fail)();
            return;
          }
          const listState = latest.current.listRef.current?.getState();
          if (listState) {
            bounds.current.offset = listState.scroll;
            bounds.current.maximum = Math.max(
              bounds.current.minimum,
              listState.contentLength - listState.scrollLength,
            );
          }
          const version = ++generation.current;
          measured.current.clear();
          viewport.current?.measureInWindow((_, top, __, height) => {
            bounds.current.top = top;
            bounds.current.height = height;
          });
          const entries = [...rows.current];
          let remaining = entries.length;
          if (remaining === 0) runOnUI(manager.fail)();
          for (const [key, row] of entries)
            measure(key, row, () => {
              remaining -= 1;
              if (remaining > 0 || version !== generation.current) return;
              const source = [...measured.current.values()].find(
                (candidate) =>
                  candidate.enabled &&
                  touch.absoluteX >= candidate.left + candidate.width - 44 &&
                  touch.absoluteX <= candidate.left + candidate.width &&
                  touch.absoluteY + bounds.current.offset >= candidate.top &&
                  touch.absoluteY + bounds.current.offset < candidate.top + candidate.height,
              );
              if (!source) {
                runOnUI(manager.fail)();
                return;
              }
              latest.current.onStart();
              drag.current = { row: source, y: touch.absoluteY, destination: null };
              setPreview({ key: source.key, title: source.thread.title, destination: null });
              update(touch.absoluteY);
              runOnUI(manager.activate)();
              let last = performance.now();
              const tick = () => {
                const current = drag.current;
                if (!current) return;
                const now = performance.now();
                const dt = Math.min(now - last, 32) / 1000;
                last = now;
                const geometry = bounds.current;
                const speed = threadListDragScrollSpeed(current.y, geometry.top, geometry.height);
                const offset = Math.max(
                  geometry.minimum,
                  Math.min(geometry.maximum, geometry.offset + speed * dt),
                );
                if (offset !== geometry.offset) {
                  latest.current.listRef.current?.scrollToOffset({ offset, animated: false });
                }
                frame.current = requestAnimationFrame(tick);
              };
              frame.current = requestAnimationFrame(tick);
            });
        })
        .onTouchesUp((_, manager) => {
          if (!drag.current) {
            generation.current += 1;
            runOnUI(manager.fail)();
          }
        })
        .onUpdate((event) => update(event.absoluteY))
        .onEnd((event, success) => {
          if (success) update(event.absoluteY);
          const current = drag.current;
          stop();
          if (success && current?.destination)
            void latest.current.onMove(current.row.thread, current.destination);
        })
        .onFinalize(() => stop()),
    [measure, stop, update, viewport],
  );

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement, contentInset } = event.nativeEvent;
      bounds.current.offset = contentOffset.y;
      bounds.current.minimum = -contentInset.top;
      bounds.current.maximum = Math.max(
        -contentInset.top,
        contentSize.height - layoutMeasurement.height + contentInset.bottom,
      );
      if (drag.current) update(drag.current.y);
    },
    [update],
  );
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      if (drag.current && (width !== bounds.current.width || height !== bounds.current.height))
        stop();
      bounds.current.width = width;
      bounds.current.height = height;
    },
    [stop],
  );
  const context = useMemo(() => ({ register, disabled, preview }), [register, disabled, preview]);
  return {
    context,
    viewport,
    gesture,
    translation,
    onScroll,
    onLayout,
    dragging: preview !== null,
  };
}

const DragContext = createContext<ReturnType<typeof useThreadListDrag>["context"] | null>(null);

export function ThreadListDragProvider(props: {
  drag: ReturnType<typeof useThreadListDrag>;
  children: ReactNode;
}) {
  const { drag } = props;
  return (
    <DragContext value={drag.context}>
      <GestureDetector gesture={drag.gesture}>
        <View ref={drag.viewport} onLayout={drag.onLayout} collapsable={false} style={{ flex: 1 }}>
          {props.children}
          {drag.context.preview && (
            <Animated.View
              pointerEvents="none"
              style={{
                position: "absolute",
                top: 0,
                left: 8,
                right: 8,
                transform: [{ translateY: drag.translation }],
              }}
            >
              <View className="min-h-12 flex-row items-center gap-3 rounded-xl border border-border bg-screen px-4 py-3">
                <Text numberOfLines={1} className="flex-1 text-base font-t3-medium">
                  {drag.context.preview.title}
                </Text>
                <SymbolView
                  name="line.3.horizontal"
                  size={20}
                  tintColorClassName="accent-foreground-muted"
                />
              </View>
            </Animated.View>
          )}
        </View>
      </GestureDetector>
    </DragContext>
  );
}

export function ThreadListDragRow(props: {
  thread: EnvironmentThreadShell;
  section: "pinned" | "active" | null;
  enabled: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onStep: (direction: "up" | "down") => void;
  children: ReactNode;
}) {
  const context = useContext(DragContext);
  const view = useRef<ViewInstance>(null);
  const key = scopedThreadKey(props.thread.environmentId, props.thread.id);
  const register = context?.register;
  useEffect(() => {
    if (!register || !view.current || !props.section) return;
    return register(key, {
      thread: props.thread,
      section: props.section,
      enabled: props.enabled,
      view: view.current,
    });
  }, [register, key, props.thread, props.section, props.enabled]);
  const destination = context?.preview?.destination;
  const target = destination?.targetId === key;
  const showHandle = context !== null && props.section !== null && props.enabled;
  return (
    <View
      ref={view}
      collapsable={false}
      style={{ flexDirection: "row", opacity: context?.preview?.key === key ? 0.35 : 1 }}
    >
      <View style={{ flex: 1 }}>{props.children}</View>
      {showHandle && (
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`Reorder ${props.thread.title}`}
          accessibilityHint="Drag up or down to reorder this thread."
          accessibilityState={{ disabled: context.disabled }}
          accessibilityActions={
            context.disabled
              ? []
              : [
                  ...(props.canMoveUp ? [{ name: "decrement", label: "Move up" }] : []),
                  ...(props.canMoveDown ? [{ name: "increment", label: "Move down" }] : []),
                ]
          }
          onAccessibilityAction={({ nativeEvent }) => {
            if (context.disabled) return;
            if (nativeEvent.actionName === "decrement" && props.canMoveUp) props.onStep("up");
            if (nativeEvent.actionName === "increment" && props.canMoveDown) props.onStep("down");
          }}
          style={{
            width: 44,
            alignItems: "center",
            justifyContent: "center",
            opacity: context.disabled ? 0.3 : 1,
          }}
        >
          <SymbolView
            name="line.3.horizontal"
            size={18}
            tintColorClassName="accent-foreground-muted"
          />
        </View>
      )}
      {target && (
        <View
          pointerEvents="none"
          className="absolute left-0 right-0 h-0.5 bg-primary"
          style={destination.placement === "before" ? { top: 0 } : { bottom: 0 }}
        />
      )}
    </View>
  );
}
