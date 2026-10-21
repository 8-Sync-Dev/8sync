"use client";

import { RoomSend } from "./room-send";
import type { Hq } from "./use-hq";
import type { Room } from "./use-office";

/**
 * The composer under Văn phòng and Chat tổng: one room (POST /api/messages) or every room of a
 * project / of all projects (`8sync ccc auto add "<việc>" [--now]`, POST /api/targets), with the
 * lead suggestion that saves tokens.
 */
export function BroadcastComposer({ hq, rooms, preferRoot }: { hq: Hq; rooms: Room[]; preferRoot?: string | null }) {
  return (
    <div className="shrink-0 border-t bg-background">
      <RoomSend
        api={hq.api}
        rooms={rooms}
        id="broadcast"
        preferRoot={preferRoot}
        onMessage={(m) => hq.mergeMessages([m])}
        placeholder="Một việc cho cả team hay một phòng, vd: webhook 500 on retry · @ để chèn file · / để chọn lệnh (Ctrl+Enter để gửi)"
        className="mx-auto w-full max-w-3xl px-4 py-3 max-sm:py-2 sm:px-6"
      />
    </div>
  );
}
