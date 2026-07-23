import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from "react";
import {
  MESSAGE_GAP,
  MESSAGE_VIRTUALIZATION_THRESHOLD,
  buildVirtualMessageLayout,
  visibleVirtualMessageRange
} from "./message-virtualization";
import type { ChatMessage } from "./types";

export function VirtualMessageList({
  messages,
  scrollerRef,
  renderMessage,
  gap = MESSAGE_GAP
}: {
  messages: ChatMessage[];
  scrollerRef: RefObject<HTMLDivElement | null>;
  renderMessage(message: ChatMessage, index: number): ReactNode;
  gap?: number;
}) {
  const virtualized =
    messages.length >= MESSAGE_VIRTUALIZATION_THRESHOLD;
  const [measuredHeights, setMeasuredHeights] = useState(
    () => new Map<string, number>()
  );
  const measuredHeightsRef = useRef(measuredHeights);
  const pendingScrollCorrectionRef = useRef(0);
  const scrollCorrectionFrameRef = useRef<number | null>(null);
  const [viewport, setViewport] = useState({
    scrollTop: 0,
    height: 0
  });
  const ids = useMemo(() => messages.map((message) => message.id), [messages]);
  const layout = useMemo(
    () => buildVirtualMessageLayout(ids, measuredHeights, undefined, gap),
    [gap, ids, measuredHeights]
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const range = visibleVirtualMessageRange(
    layout,
    viewport.scrollTop,
    viewport.height
  );

  useLayoutEffect(() => {
    if (!virtualized) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const updateViewport = () => {
      setViewport({
        scrollTop: scroller.scrollTop,
        height: scroller.clientHeight
      });
    };
    updateViewport();
    scroller.addEventListener("scroll", updateViewport, { passive: true });
    const resizeObserver = new ResizeObserver(updateViewport);
    resizeObserver.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", updateViewport);
      resizeObserver.disconnect();
    };
  }, [scrollerRef, virtualized]);

  useEffect(() => {
    const currentIds = new Set(ids);
    setMeasuredHeights((current) => {
      if ([...current.keys()].every((id) => currentIds.has(id))) return current;
      const next = new Map(
        [...current].filter(([id]) => currentIds.has(id))
      );
      measuredHeightsRef.current = next;
      return next;
    });
  }, [ids]);

  useEffect(() => () => {
    if (scrollCorrectionFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollCorrectionFrameRef.current);
    }
  }, []);

  const onMeasure = useCallback((
    id: string,
    height: number
  ) => {
    if (!Number.isFinite(height) || height <= 0) return;
    const scroller = scrollerRef.current;
    const stickToBottom = scroller
      ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120
      : false;
    const current = measuredHeightsRef.current;
    const previous = current.get(id);
    if (previous !== undefined && Math.abs(previous - height) < 1) return;
    const next = new Map(current);
    next.set(id, height);
    measuredHeightsRef.current = next;
    setMeasuredHeights(next);
    if (stickToBottom && scroller) {
      window.requestAnimationFrame(() => {
        scroller.scrollTop = scroller.scrollHeight;
      });
      return;
    }
    const index = idsRef.current.indexOf(id);
    const rowOffset =
      index >= 0 ? layoutRef.current.offsets[index] : undefined;
    if (
      scroller &&
      rowOffset !== undefined &&
      rowOffset < scroller.scrollTop
    ) {
      const previousHeight = previous ?? layoutRef.current.heights[index]!;
      pendingScrollCorrectionRef.current += height - previousHeight;
      if (scrollCorrectionFrameRef.current === null) {
        scrollCorrectionFrameRef.current = window.requestAnimationFrame(() => {
          scroller.scrollTop += pendingScrollCorrectionRef.current;
          pendingScrollCorrectionRef.current = 0;
          scrollCorrectionFrameRef.current = null;
        });
      }
    }
  }, [scrollerRef]);

  if (!virtualized) {
    return (
      <div className="message-list">
        {messages.map(renderMessage)}
      </div>
    );
  }

  return (
    <div
      className="virtual-message-list"
      data-message-count={messages.length}
      data-rendered-count={range.end - range.start}
      style={{ height: `${layout.totalHeight}px` }}
    >
      {messages.slice(range.start, range.end).map((message, relativeIndex) => {
        const index = range.start + relativeIndex;
        return (
          <MeasuredVirtualMessage
            key={message.id}
            id={message.id}
            last={index === messages.length - 1}
            offset={layout.offsets[index]!}
            onMeasure={onMeasure}
          >
            {renderMessage(message, index)}
          </MeasuredVirtualMessage>
        );
      })}
    </div>
  );
}

function MeasuredVirtualMessage({
  id,
  last,
  offset,
  onMeasure,
  children
}: {
  id: string;
  last: boolean;
  offset: number;
  onMeasure(id: string, height: number): void;
  children: ReactNode;
}) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => onMeasure(id, element.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, id, onMeasure]);

  return (
    <div
      className={`virtual-message-row${last ? " is-last" : ""}`}
      ref={setElement}
      style={{ transform: `translateY(${offset}px)` }}
    >
      {children}
    </div>
  );
}
