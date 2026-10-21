"use client";

import { useState } from "react";
import { ComposerDock } from "./composer-dock";
import { RoomSend } from "./room-send";
import type { Hq } from "./use-hq";
import type { Room } from "./use-office";

/**
 * The composer under Văn phòng and Chat tổng: one room (POST /api/messages) or every room of a
 * project / of all projects (`8sync ccc auto add "<việc>" [--now]`, POST /api/targets), with the
 * lead suggestion that saves tokens. On a phone it folds into the floating send button (ComposerDock).
 */
export function BroadcastComposer({ hq, rooms, preferRoot }: { hq: Hq; rooms: Room[]; preferRoot?: string | null }) {
  const [draft, setDraft] = useState(false);
  return (
    <ComposerDock id="broadcast" draft={draft} label="Gửi cho mọi phòng">
      {({ close }) => (
        <div className="shrink-0 border-t bg-background">
          <RoomSend
            api={hq.api}
            token={hq.token}
            rooms={rooms}
            id="broadcast"
            preferRoot={preferRoot}
            onMessage={(m) => hq.mergeMessages([m])}
            onSent={close}
            onDraft={setDraft}
            placeholder="Một việc cho cả team hay một phòng, vd: webhook 500 on retry · @ để chèn file · / để chọn lệnh (Ctrl+Enter để gửi)"
            className="mx-auto w-full max-w-3xl px-4 py-3 max-sm:py-2 sm:px-6"
          />
        </div>
      )}
    </ComposerDock>
  );
}
