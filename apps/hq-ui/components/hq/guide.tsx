"use client";

import {
  BellRingIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  CoffeeIcon,
  EyeIcon,
  FolderPlusIcon,
  HourglassIcon,
  MessagesSquareIcon,
  PowerIcon,
  SendIcon,
  TerminalIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type GuideStep = { icon: LucideIcon; title: string; body: string };

export const GUIDE_STEPS: GuideStep[] = [
  {
    icon: FolderPlusIcon,
    title: "Mở team cho dự án",
    body:
      "Thêm thư mục ở \"Mở team ở repo mới\" bên trái (dự án đã có phòng tự hiện), rồi bấm \"Mở team\": 5 phòng nền chạy liên tục. " +
      "lead và rd dùng Opus (claude-opus-5-5) để chia việc, nghiên cứu; dev và review dùng Sonnet (claude-sonnet-5-5) để code, duyệt; qa dùng Haiku (claude-haiku-5-5) để kiểm nhanh. " +
      "\"Team đầy đủ\" mở 6 phòng, 3 phòng code (lead, dev, dev2, ui, qa, review), tốn quota gần gấp 6 lần một phòng. " +
      "\"Sấm Sét\" (đầu dự án ở Tổng quan và Văn phòng) mở 9 phòng: 5 builder, 2 QA, lease 2 giờ, tốn quota khoảng 9 lần; đang chạy thì bấm lại để gia hạn. Phòng ba, arch, rd chỉ mở khi cần (`--roles`).",
  },
  {
    icon: SendIcon,
    title: "Giao việc",
    body:
      "Bấm \"Giao việc\" hoặc gõ vào ô \"Gửi cho mọi phòng\": việc thành card trên Board. lead viết tiêu chí và lệnh kiểm, dev làm trên nhánh card-<số>, qa kiểm, review duyệt. " +
      "Việc gấp: mở card, chọn P0 (phòng nhận trước mọi card khác).",
  },
  {
    icon: TerminalIcon,
    title: "Theo dõi như một ngày làm việc",
    body:
      "Văn phòng: mỗi phòng đang làm gì, giữ card nào. Board: card đi Backlog → Ready → Building → QA → Review → Approved; bấm card để xem chi tiết. " +
      "Bấm tên phòng ở bên trái để xem Nhật ký từng bước nó làm, hoặc mở terminal của phòng.",
  },
  {
    icon: BellRingIcon,
    title: "Chỉ trả lời việc cần anh",
    body:
      "Khung \"Anh cần trả lời\" hiện câu hỏi và xin quyền của mọi phòng. Im lặng 60 giây: câu hỏi sản phẩm/kỹ thuật thì critic (Opus) chọn; xin quyền thì việc an toàn trong dự án (test, sửa file, đẩy nhánh card) tự chạy, còn merge, release, cài gói, file secret luôn chờ anh. " +
      "Câu Ship (merge, phát hành) chỉ anh trả lời.",
  },
  {
    icon: MessagesSquareIcon,
    title: "Cập nhật và dừng",
    body:
      "Sau `8sync up`, bấm \"Dọn & mở lại\": phòng rảnh chạy lại trên bản mới, giữ hội thoại; session rác được dọn, worktree còn thay đổi được giữ. Bấm \"Dừng team\" để nghỉ (hội thoại vẫn giữ). " +
      "Chat tổng xem các phòng nhắn nhau và bàn giao \"A → B\".",
  },
  {
    icon: PowerIcon,
    title: "CLI chỉ để bật / tắt",
    body:
      "Terminal chỉ cần hai lệnh: `8sync ccc auto on [--omp]` bật chạy liên tục (--omp cho Đội omp làm cạnh Đội ccc) và `8sync hq ui [--public]` mở HQ (--public in link internet để mở từ điện thoại, hết hạn sau 12 giờ). " +
      "Mọi việc khác làm ở đây: Tạm dừng / Chạy liên tục, công tắc Đội omp, giao việc, trả lời câu hỏi. Phòng dừng vì hết usage hoặc lỗi API tự chạy lại; chỉ phòng ghi \"cần anh xử lý\" mới chờ anh.",
  },
];

export const GUIDE_LEGEND: { icon: LucideIcon; label: string; hint: string }[] = [
  { icon: CircleDotIcon, label: "Đang làm", hint: "đang chạy việc" },
  { icon: BellRingIcon, label: "Cần bạn", hint: "chờ bạn trả lời hoặc duyệt" },
  { icon: EyeIcon, label: "Chờ review", hint: "làm xong, chờ người kiểm" },
  { icon: CheckCircle2Icon, label: "Xong", hint: "đã hoàn thành" },
  { icon: CoffeeIcon, label: "Rảnh", hint: "chưa có việc" },
];

export const GUIDE_TIPS: string[] = [
  "/do cho việc nhỏ (sửa nhanh, đổi tên): một lượt, không cần plan.",
  "/ship-loop cho việc chạy dài: luôn đặt giới hạn (số vòng, số phút) để không tốn thêm.",
  "Dùng Haiku cho test và việc lặp lại: rẻ và nhanh.",
];

const KEY = "hq.guide.seen";

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return true; // can't remember -> don't nag
  }
}

function markSeen() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* private mode */
  }
}

/** "Lần đầu?" — true once on a browser that never closed the guide. */
export function useGuideFirstRun(): [boolean, () => void] {
  const [first, setFirst] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage only exists on the client
    setFirst(!seen());
  }, []);
  return [first, () => setFirst(false)];
}

export function Guide({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) markSeen();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Cách dùng</DialogTitle>
          <DialogDescription>Lần đầu? Làm theo 5 bước này.</DialogDescription>
        </DialogHeader>
        <ol className="flex flex-col gap-3">
          {GUIDE_STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <s.icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
              <div>
                <p className="text-sm font-medium">
                  {i + 1}. {s.title}
                </p>
                <p className="text-sm text-muted-foreground">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <section>
          <h3 className="mb-2 text-sm font-medium">Ý nghĩa biểu tượng</h3>
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
            {GUIDE_LEGEND.map((l) => (
              <li key={l.label} className="flex items-center gap-2">
                <l.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="font-medium">{l.label}</span>
                <span className="text-muted-foreground">{l.hint}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
            <HourglassIcon className="size-4 text-muted-foreground" aria-hidden />
            Mẹo tiết kiệm
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {GUIDE_TIPS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      </DialogContent>
    </Dialog>
  );
}
