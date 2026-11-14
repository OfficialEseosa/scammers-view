"use client";

import { useSyncExternalStore } from "react";
import { AttackMap as ListMap, type AttackMapProps } from "./AttackMap";
import { FlowMap } from "./FlowMap";

const QUERY = "(max-width: 767px)";

function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** Wide screens get the flow graph; phones keep the list of ways in. */
export function ResponsiveAttackMap(props: AttackMapProps) {
  const narrow = useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
  return narrow ? <ListMap {...props} /> : <FlowMap {...props} />;
}
