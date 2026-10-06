state: spec-review
round:
  spec-draft: 3
  playtest: 0
log:
- 2026-10-06 建立, 概念寫入 concept.md; 遊戲名 GhostEcho(老闆指定, 不用中文名)
- 2026-10-06 concept 定案(decisions v1), 轉 spec-draft
- 2026-10-07 spec v1、telemetry v1、guide v1 落地(待定 4 項), 轉 spec-review
- 2026-10-07 spec v1 退回(decisions v2), 轉 spec-draft 第 2 版; 理由: 尖刺隨幽靈循環重設造成第二代幽靈時間軸錯位, 第 3 關直覺跑跳即正解驗不到規劃且需重做地形(超出就地修正範圍), 難度斜率倒置, 鉤爪漏洞
- 2026-10-07 spec v2、telemetry v2、guide v2 落地(待定 3 項; 第 3 關改為需 2 代), 轉 spec-review
- 2026-10-07 spec v2 退回(decisions v3), 轉 spec-draft 第 3 版; 理由: 第 3、4 關直覺跑跳可能落上矮樁湊出預期解、另有三條邊際 0~0.3 格的捷徑、第 3 關鉤爪執行窗 0.19 秒; 手算邊際小於站位誤差無法收斂, 改定驗算原則並由 RD 在 build 做逐幀自動驗證
- 2026-10-07 spec v3、telemetry v3、guide v3 落地(待定 1 項; 第 3、4 關用半格高度, 製作人接受), 轉 spec-review
