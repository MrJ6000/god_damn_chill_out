"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type { DemoNotice } from "@/lib/api";
import {
  buildCompromisedPlan,
  buildNormalPlan,
  executeApproved,
  loadBlastRadius,
  loadInbox,
  NORMAL_DEMO_INVOICE_ID,
  runDirectBypass,
  selectReceiptForNavigation,
} from "@/lib/demoWorkflow";
import {
  createInitialDemoState,
  DEMO_STORAGE_KEY,
  parseDemoState,
  selectPlan,
  serializeDemoState,
  type DemoState,
} from "@/lib/demoState";

interface DemoContextValue {
  busy: boolean;
  error?: string;
  hydrated: boolean;
  latestNotice?: DemoNotice;
  phase: string;
  prepareNormalPlan: () => Promise<void>;
  refreshBlastRadius: () => Promise<void>;
  refreshInbox: () => Promise<void>;
  resetDemo: () => void;
  runCompromisedDemo: () => Promise<void>;
  runDirectBypassDemo: () => Promise<void>;
  runNormalDemo: () => Promise<void>;
  executeCurrentPlan: () => Promise<void>;
  state: DemoState;
}

const DemoContext = createContext<DemoContextValue | null>(null);

function lastNotice(state: DemoState): DemoNotice | undefined {
  const candidates = [
    state.attack?.notice ? { at: state.attack.updatedAt, notice: state.attack.notice } : undefined,
    state.blastRadius?.notice ? { at: state.blastRadius.updatedAt, notice: state.blastRadius.notice } : undefined,
    state.execution?.notices.at(-1) ? { at: state.execution.updatedAt, notice: state.execution.notices.at(-1)! } : undefined,
    state.plan?.notices.at(-1) ? { at: state.plan.updatedAt, notice: state.plan.notices.at(-1)! } : undefined,
    state.inbox?.notices.at(-1) ? { at: state.inbox.updatedAt, notice: state.inbox.notices.at(-1)! } : undefined,
  ].filter((candidate): candidate is { at: string; notice: DemoNotice } => Boolean(candidate));
  return candidates.sort((left, right) => right.at.localeCompare(left.at))[0]?.notice;
}

export function DemoProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<DemoState>(createInitialDemoState);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("等待示範操作");
  const [error, setError] = useState<string>();
  const runId = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    try {
      const stored = parseDemoState(window.sessionStorage.getItem(DEMO_STORAGE_KEY));
      if (stored) setState(stored);
    } catch (caught) {
      console.warn("[PolicyVault] Unable to read demo state from sessionStorage; continuing in memory.", caught);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.sessionStorage.setItem(DEMO_STORAGE_KEY, serializeDemoState(state));
    } catch (caught) {
      console.warn("[PolicyVault] Unable to persist demo state to sessionStorage; continuing in memory.", caught);
    }
  }, [hydrated, state]);

  const beginRun = useCallback((nextPhase: string): number | undefined => {
    if (busyRef.current) return undefined;
    busyRef.current = true;
    const id = ++runId.current;
    setBusy(true);
    setError(undefined);
    setPhase(nextPhase);
    return id;
  }, []);

  const finishRun = useCallback((id: number, nextPhase: string) => {
    if (runId.current !== id) return;
    busyRef.current = false;
    setBusy(false);
    setPhase(nextPhase);
  }, []);

  const failRun = useCallback((id: number, caught: unknown) => {
    if (runId.current !== id) return;
    busyRef.current = false;
    setBusy(false);
    setPhase("示範流程需要處理");
    setError(caught instanceof Error ? caught.message : "示範流程發生未知錯誤。");
  }, []);

  const refreshInbox = useCallback(async () => {
    const id = beginRun("正在載入待付款資料…");
    if (id === undefined) return;
    try {
      const inbox = await loadInbox();
      if (runId.current !== id) return;
      setState((current) => ({ ...current, inbox }));
      finishRun(id, inbox.source === "api" ? "待付款資料已由 API 載入" : "目前使用前端備援待付款資料");
    } catch (caught) {
      failRun(id, caught);
    }
  }, [beginRun, failRun, finishRun]);

  const prepareNormalPlan = useCallback(async () => {
    const id = beginRun("AI 正在建立付款提案並執行 18 項政策檢查…");
    if (id === undefined) return;
    try {
      const plan = await buildNormalPlan();
      if (runId.current !== id) return;
      setState((current) => ({
        ...current,
        attack: undefined,
        execution: undefined,
        inbox: plan,
        plan,
        scenario: "normal",
      }));
      finishRun(id, plan.source === "api" ? "API 付款計畫已完成" : "後端不可用，已載入一致的前端備援計畫");
      router.push("/plan");
    } catch (caught) {
      failRun(id, caught);
    }
  }, [beginRun, failRun, finishRun, router]);

  const executeScene = useCallback(async (planOverride?: ReturnType<typeof selectPlan>) => {
    const id = beginRun(`正在執行示範付款 ${NORMAL_DEMO_INVOICE_ID}…`);
    if (id === undefined) return;
    try {
      const plan = planOverride ?? selectPlan(state);
      const execution = await executeApproved(plan);
      if (runId.current !== id) return;
      const destination = selectReceiptForNavigation(execution);
      setState((current) => ({ ...current, execution, plan, scenario: "normal" }));
      if (!destination) {
        router.push("/plan");
        throw new Error("沒有已完成或已廣播的付款；請查看執行狀態後再試一次。");
      }
      finishRun(
        id,
        execution.source === "api"
          ? "已收到 API 付款憑證"
          : execution.source === "mixed"
            ? "部分 API 執行未知，已清楚標示備援憑證"
            : "目前顯示前端備援付款憑證",
      );
      router.push(`/receipt/${destination.receipt.payment_id}`);
    } catch (caught) {
      failRun(id, caught);
    }
  }, [beginRun, failRun, finishRun, router, state]);

  const executeCurrentPlan = useCallback(async () => {
    await executeScene();
  }, [executeScene]);

  const runNormalDemo = useCallback(async () => {
    const id = beginRun("正在建立正常付款計畫…");
    if (id === undefined) return;
    try {
      const plan = await buildNormalPlan();
      if (runId.current !== id) return;
      setState((current) => ({
        ...current,
        attack: undefined,
        blastRadius: undefined,
        execution: undefined,
        inbox: plan,
        plan,
        scenario: "normal",
      }));
      setPhase(`正在執行示範付款 ${NORMAL_DEMO_INVOICE_ID}…`);
      const execution = await executeApproved(plan);
      if (runId.current !== id) return;
      const destination = selectReceiptForNavigation(execution);
      setState((current) => ({ ...current, execution, plan, scenario: "normal" }));
      if (!destination) {
        router.push("/plan");
        throw new Error("沒有已完成或已廣播的付款；已保留本次執行結果供檢查。");
      }
      finishRun(
        id,
        execution.source === "api"
          ? "正常付款情境完成"
          : execution.source === "mixed"
            ? "正常付款部分使用備援資料"
            : "正常付款以備援情境完成",
      );
      router.push(`/receipt/${destination.receipt.payment_id}`);
    } catch (caught) {
      failRun(id, caught);
    }
  }, [beginRun, failRun, finishRun, router]);

  const runCompromisedDemo = useCallback(async () => {
    const id = beginRun("正在讓 AI 處理遭竄改的 INV-8821…");
    if (id === undefined) return;
    try {
      const plan = await buildCompromisedPlan();
      if (runId.current !== id) return;
      const intent = plan.intents[0];
      if (!intent) throw new Error("AI 遭入侵情境沒有產生付款提案。");
      setState((current) => ({
        ...current,
        attack: undefined,
        blastRadius: undefined,
        execution: undefined,
        inbox: { ...plan, invoices: plan.invoices },
        plan,
        scenario: "compromised",
      }));
      finishRun(id, plan.source === "api" ? "政策引擎已完成惡意付款判定" : "目前顯示一致的前端備援攻擊情境");
      router.push(`/decision/${intent.intent_id}`);
    } catch (caught) {
      failRun(id, caught);
    }
  }, [beginRun, failRun, finishRun, router]);

  const runDirectBypassDemo = useCallback(async () => {
    const id = beginRun("正在送出直接攻擊示範請求…");
    if (id === undefined) return;
    try {
      const attack = await runDirectBypass();
      if (runId.current !== id) return;
      setState((current) => ({ ...current, attack, blastRadius: undefined, scenario: "direct-bypass" }));
      finishRun(
        id,
        attack.source === "api"
          ? "已收到 API 的直接攻擊結果"
          : "鏈上示範不可用，已切換到明示的備援情境",
      );
      router.push("/attack");
    } catch (caught) {
      failRun(id, caught);
    }
  }, [beginRun, failRun, finishRun, router]);

  const refreshBlastRadius = useCallback(async () => {
    const id = beginRun("正在讀取權限與風險範圍…");
    if (id === undefined) return;
    try {
      const blastRadius = await loadBlastRadius();
      if (runId.current !== id) return;
      setState((current) => ({ ...current, blastRadius }));
      finishRun(id, blastRadius.source === "api" ? "風險範圍已由 API 載入" : "目前使用快取備援風險資料");
    } catch (caught) {
      failRun(id, caught);
    }
  }, [beginRun, failRun, finishRun]);

  const resetDemo = useCallback(() => {
    if (busyRef.current) {
      setError("付款或攻擊請求仍在執行，為避免重複送出，完成前不能重設畫面。");
      return;
    }
    runId.current += 1;
    busyRef.current = false;
    setBusy(false);
    setError(undefined);
    setPhase("前端畫面已重設；後端既有付款紀錄不會被清除");
    setState(createInitialDemoState());
    try {
      window.sessionStorage.removeItem(DEMO_STORAGE_KEY);
    } catch (caught) {
      console.warn("[PolicyVault] Unable to clear demo state from sessionStorage.", caught);
    }
    router.push("/");
  }, [router]);

  const value = useMemo<DemoContextValue>(() => ({
    busy,
    error,
    executeCurrentPlan,
    hydrated,
    latestNotice: lastNotice(state),
    phase,
    prepareNormalPlan,
    refreshBlastRadius,
    refreshInbox,
    resetDemo,
    runCompromisedDemo,
    runDirectBypassDemo,
    runNormalDemo,
    state,
  }), [
    busy,
    error,
    executeCurrentPlan,
    hydrated,
    phase,
    prepareNormalPlan,
    refreshBlastRadius,
    refreshInbox,
    resetDemo,
    runCompromisedDemo,
    runDirectBypassDemo,
    runNormalDemo,
    state,
  ]);

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo(): DemoContextValue {
  const context = useContext(DemoContext);
  if (!context) throw new Error("useDemo must be used inside DemoProvider.");
  return context;
}
