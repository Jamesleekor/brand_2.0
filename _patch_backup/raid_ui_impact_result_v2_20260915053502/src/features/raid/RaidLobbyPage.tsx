import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';

import { LoadingSpinner } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import {
  raidStudentRpc,
  type RaidLobbyMe,
  type RaidLobbyMessage,
  type RaidStatus,
} from '@/lib/rpc/raid_student_rpc';
import { cn } from '@/lib/utils/cn';
import { useRaidLobbyRealtime } from '@/features/raid/hooks/useRaidLobbyRealtime';

type BubbleState = Record<number, RaidLobbyMessage>;

type LobbyPlayer = RaidLobbyMe & { joined_at: string };

interface PositionedPlayer {
  player: LobbyPlayer;
  x: number;
  y: number;
  guildKey: string;
}

interface GuildCluster {
  key: string;
  name: string;
  logoUrl: string | null;
  x: number;
  y: number;
}

const CLUSTER_CENTERS = [
  { x: 17, y: 34 },
  { x: 18, y: 69 },
  { x: 50, y: 80 },
  { x: 82, y: 69 },
  { x: 83, y: 34 },
  { x: 50, y: 31 },
];

const MEMBER_OFFSETS = [
  { x: 0, y: 0 },
  { x: -6, y: 7 },
  { x: 6, y: 7 },
  { x: -3.5, y: 15 },
  { x: 3.5, y: 15 },
  { x: 0, y: 22 },
];

export default function RaidLobbyPage() {
  const params = useParams<{ raidId: string }>();
  const navigate = useNavigate();
  const raidId = Number(params.raidId);

  const [messages, setMessages] = useState<RaidLobbyMessage[]>([]);
  const [bubbles, setBubbles] = useState<BubbleState>({});
  const bubbleTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const [messageInput, setMessageInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const lobbyQuery = useQuery({
    queryKey: ['raid-lobby', raidId],
    enabled: Number.isFinite(raidId) && raidId > 0,
    queryFn: async () => {
      const result = await raidStudentRpc.lobby(supabase, raidId);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    staleTime: 1500,
    refetchInterval: 3000,
    refetchOnWindowFocus: true,
  });

  const snapshot = lobbyQuery.data;
  const chatAvailable = Boolean(
    snapshot?.raid.chat_enabled &&
      snapshot?.raid.status &&
      ['LOBBY_OPEN', 'ACTIVE', 'PAUSED'].includes(snapshot.raid.status),
  );

  const me = useMemo<RaidLobbyMe | null>(() => {
    const raw = snapshot?.me;
    if (!raw) return null;
    return {
      student_id: raw.student_id,
      name: raw.name,
      brand_name: raw.brand_name,
      equipped_character_id: raw.equipped_character_id,
      equipped_character_name: raw.equipped_character_name,
      equipped_character_image_url: raw.equipped_character_image_url,
      guild_id: raw.guild_id,
      guild_name: raw.guild_name,
      guild_logo_url: raw.guild_logo_url,
    };
  }, [
    snapshot?.me?.student_id,
    snapshot?.me?.name,
    snapshot?.me?.brand_name,
    snapshot?.me?.equipped_character_id,
    snapshot?.me?.equipped_character_name,
    snapshot?.me?.equipped_character_image_url,
    snapshot?.me?.guild_id,
    snapshot?.me?.guild_name,
    snapshot?.me?.guild_logo_url,
  ]);

  const showBubble = useCallback((message: RaidLobbyMessage) => {
    setBubbles((current) => ({
      ...current,
      [message.student_id]: message,
    }));

    const previous = bubbleTimers.current[message.student_id];
    if (previous) clearTimeout(previous);

    bubbleTimers.current[message.student_id] = setTimeout(() => {
      setBubbles((current) => {
        if (current[message.student_id]?.id !== message.id) return current;
        const next = { ...current };
        delete next[message.student_id];
        return next;
      });
      delete bubbleTimers.current[message.student_id];
    }, 5500);
  }, []);

  const mergeMessage = useCallback(
    (message: RaidLobbyMessage, bubble: boolean) => {
      setMessages((current) => {
        const byId = new Map<number, RaidLobbyMessage>();
        current.forEach((item) => byId.set(item.id, item));
        byId.set(message.id, message);
        return [...byId.values()]
          .sort(
            (a, b) =>
              new Date(a.created_at).getTime() -
              new Date(b.created_at).getTime(),
          )
          .slice(-50);
      });
      if (bubble) showBubble(message);
    },
    [showBubble],
  );

  const handleRealtimeMessage = useCallback(
    (message: RaidLobbyMessage) => {
      mergeMessage(message, true);
    },
    [mergeMessage],
  );

  const realtime = useRaidLobbyRealtime({
    raidId,
    studentId: me?.student_id ?? null,
    onChatMessage: handleRealtimeMessage,
  });

  useEffect(() => {
    const serverMessages = snapshot?.recent_messages ?? [];
    if (serverMessages.length === 0) return;
    setMessages((current) => {
      const byId = new Map<number, RaidLobbyMessage>();
      current.forEach((item) => byId.set(item.id, item));
      serverMessages.forEach((item) => byId.set(item.id, item));
      return [...byId.values()]
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() -
            new Date(b.created_at).getTime(),
        )
        .slice(-50);
    });
  }, [snapshot?.recent_messages]);

  useEffect(
    () => () => {
      Object.values(bubbleTimers.current).forEach((timer) => clearTimeout(timer));
    },
    [],
  );

  const displayPlayers = useMemo<LobbyPlayer[]>(() => {
    const presenceByStudent = new Map(
      realtime.players.map((player) => [player.student_id, player]),
    );
    if (me && !presenceByStudent.has(me.student_id)) {
      presenceByStudent.set(me.student_id, {
        student_id: me.student_id,
        joined_at: new Date().toISOString(),
      });
    }

    return (snapshot?.roster ?? [])
      .filter((student) => presenceByStudent.has(student.student_id))
      .map((student) => ({
        ...student,
        joined_at:
          presenceByStudent.get(student.student_id)?.joined_at ??
          new Date().toISOString(),
      }));
  }, [me, realtime.players, snapshot?.roster]);

  const layout = useMemo(
    () => buildLobbyLayout(displayPlayers),
    [displayPlayers],
  );

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!chatAvailable || sending) return;

    const trimmed = messageInput.trim();
    if (!trimmed) return;

    if (trimmed.length > 60) {
      setSendError('메시지는 60자까지 보낼 수 있습니다.');
      return;
    }

    setSending(true);
    setSendError(null);
    try {
      const result = await raidStudentRpc.sendLobbyMessage(
        supabase,
        raidId,
        trimmed,
      );
      if (result.success === false) {
        const slowMode = result.error.toLowerCase().includes('slow mode');
        setSendError(
          slowMode
            ? `채팅 간격은 ${snapshot.raid.chat_slow_mode_seconds}초입니다. 잠시 후 다시 보내주세요.`
            : '메시지를 보내지 못했습니다. 잠시 후 다시 시도해주세요.',
        );
        return;
      }

      const message = result.data;
      setMessageInput('');
      mergeMessage(message, true);
      await realtime.broadcastChat(message);
    } finally {
      setSending(false);
    }
  };

  if (!Number.isFinite(raidId) || raidId <= 0) {
    return <LobbyError message="잘못된 레이드 주소입니다." onBack={() => navigate('/home')} />;
  }

  if (lobbyQuery.isLoading || !snapshot) {
    if (lobbyQuery.isError) {
      return (
        <LobbyError
          message="레이드 관문에 입장할 수 없습니다. 로비가 열려 있는지 확인해주세요."
          detail={lobbyQuery.error instanceof Error ? lobbyQuery.error.message : undefined}
          onBack={() => navigate('/home')}
        />
      );
    }
    return (
      <div className="flex min-h-[calc(100vh-32px)] items-center justify-center bg-[#08121f]">
        <div className="text-center">
          <LoadingSpinner size="lg" />
          <div className="mt-3 text-sm font-black text-cyan-100">
            레이드 관문으로 이동 중...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#06101c] text-white">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 18%, rgba(56,189,248,0.18), transparent 28%), radial-gradient(circle at 50% 72%, rgba(168,85,247,0.14), transparent 34%), linear-gradient(180deg, #081424 0%, #07111f 48%, #050b14 100%)',
        }}
      />

      <header className="relative z-30 flex min-h-16 items-center justify-between gap-4 border-b border-cyan-300/20 bg-[#07111f]/90 px-4 py-3 backdrop-blur md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/home')}
            className="rounded-card-md border border-cyan-300/35 bg-cyan-500/10 px-3 py-2 text-xs font-black text-cyan-100 transition hover:bg-cyan-500/20"
          >
            ← 홈
          </button>
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-yellow-100">
              레이드 집결지
            </div>
            <div className="truncate font-display text-lg text-white">
              레이드 관문 · {snapshot.raid.title}
            </div>
          </div>
        </div>

        <div className="flex flex-none items-center gap-2">
          <span className="hidden rounded-pill border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-black text-white sm:inline">
            {elementLabel(snapshot.raid.boss_element)}
          </span>
          <span className="rounded-pill border border-emerald-300/35 bg-emerald-500/10 px-3 py-1.5 text-xs font-black text-emerald-100">
            {realtime.connected ? '● 연결됨' : '○ 연결 중'}
          </span>
          <span className="rounded-pill border border-cyan-300/35 bg-cyan-500/10 px-3 py-1.5 text-xs font-black text-cyan-100">
            접속 {displayPlayers.length}명
          </span>
        </div>
      </header>

      <div className="relative z-10 grid min-h-[calc(100vh-64px)] xl:grid-cols-[minmax(0,1fr)_330px]">
        <main className="relative min-h-[690px] overflow-hidden">
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[34%]"
            style={{
              background:
                'linear-gradient(180deg, transparent, rgba(8,47,73,0.20) 28%, rgba(15,23,42,0.82) 100%)',
            }}
          />

          <RaidGate
            status={snapshot.raid.status}
            bossName={snapshot.raid.boss_name}
            onEnterBattle={() => navigate(`/raid/${raidId}/battle`)}
          />

          {layout.clusters.map((cluster) => (
            <GuildClusterTag key={cluster.key} cluster={cluster} />
          ))}

          {layout.players.map(({ player, x, y }) => (
            <RaidLobbyAvatar
              key={player.student_id}
              player={player}
              x={x}
              y={y}
              isMe={player.student_id === me?.student_id}
              bubble={bubbles[player.student_id] ?? null}
            />
          ))}

          <div className="absolute bottom-4 left-4 z-20 rounded-card-md border border-cyan-300/25 bg-[#07111f]/80 px-3 py-2 backdrop-blur">
            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-100">
              길드 집결
            </div>
            <div className="mt-1 max-w-[460px] text-xs font-bold leading-5 text-yellow-100">
              현재 장착한 편린이 아바타로 나타납니다. 같은 길드의 동료들은 가까운 구역에 모입니다.
            </div>
          </div>
        </main>

        <aside className="relative z-20 flex min-h-[520px] flex-col border-l border-cyan-300/20 bg-[#07111f]/92 backdrop-blur">
          <div className="border-b border-cyan-300/20 p-4">
            <div className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100">
              관문 대화
            </div>
            <div className="mt-1 text-sm font-black text-white">관문 대화</div>
            <div className="mt-1 text-[11px] font-bold text-yellow-100">
              최근 50개 · {snapshot.raid.chat_slow_mode_seconds}초 간격
            </div>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {messages.length === 0 ? (
              <div className="rounded-card-md border border-dashed border-cyan-300/25 bg-cyan-500/5 p-5 text-center">
                <div className="text-2xl">💬</div>
                <div className="mt-2 text-xs font-black text-cyan-100">
                  아직 대화가 없습니다.
                </div>
              </div>
            ) : (
              messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  isMe={message.student_id === me?.student_id}
                />
              ))
            )}
          </div>

          <form
            onSubmit={sendMessage}
            className="border-t border-cyan-300/20 bg-black/15 p-3"
          >
            {!chatAvailable ? (
              <div className="rounded-card-md border border-red-300/35 bg-red-500/10 px-3 py-3 text-center text-xs font-black text-red-100">
                {snapshot.raid.status === 'COMPLETED' || snapshot.raid.status === 'FAILED'
                  ? '종료된 레이드에서는 채팅을 보낼 수 없습니다.'
                  : '선생님이 채팅을 잠갔습니다.'}
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <input
                    value={messageInput}
                    onChange={(event) => {
                      setMessageInput(event.target.value.slice(0, 60));
                      if (sendError) setSendError(null);
                    }}
                    maxLength={60}
                    placeholder="동료들에게 말하기..."
                    className="min-w-0 flex-1 rounded-card-md border border-cyan-300/30 bg-[#030811] px-3 py-2.5 text-sm font-bold text-white outline-none placeholder:text-cyan-100/45 focus:border-cyan-300/70"
                  />
                  <button
                    type="submit"
                    disabled={sending || !messageInput.trim()}
                    className="rounded-card-md border border-yellow-300/45 bg-yellow-400/10 px-4 text-xs font-black text-yellow-100 transition hover:bg-yellow-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {sending ? '...' : '전송'}
                  </button>
                </div>
                <div className="mt-1.5 flex justify-between text-[10px] font-bold">
                  <span className={sendError ? 'text-red-100' : 'text-cyan-100'}>
                    {sendError ?? '메시지는 아바타 위 말풍선으로도 표시됩니다.'}
                  </span>
                  <span className="text-yellow-100">{messageInput.length}/60</span>
                </div>
              </>
            )}
          </form>
        </aside>
      </div>
    </div>
  );
}

function RaidGate({
  status,
  bossName,
  onEnterBattle,
}: {
  status: RaidStatus;
  bossName: string;
  onEnterBattle: () => void;
}) {
  const active = status === 'ACTIVE';
  const paused = status === 'PAUSED';
  const finished =
    status === 'COMPLETED' || status === 'FAILED' || status === 'ARCHIVED';
  const canEnterBattle = active || finished;

  return (
    <div className="absolute left-1/2 top-[6%] z-10 w-[30%] min-w-[280px] max-w-[480px] -translate-x-1/2 text-center">
      <button
        type="button"
        disabled={!canEnterBattle}
        onClick={onEnterBattle}
        className={cn(
          'relative mx-auto block aspect-[0.78] w-full rounded-t-[48%] border-[3px] p-4 text-center transition duration-700',
          canEnterBattle ? 'cursor-pointer hover:-translate-y-1' : 'cursor-default',
          active
            ? 'border-yellow-200/75 shadow-[0_0_55px_rgba(250,204,21,0.28),inset_0_0_38px_rgba(56,189,248,0.18)]'
            : paused
              ? 'border-cyan-200/55 shadow-[0_0_35px_rgba(34,211,238,0.16)]'
              : 'border-cyan-300/45 shadow-[0_0_42px_rgba(34,211,238,0.18)]',
        )}
        style={{
          background:
            'linear-gradient(180deg, rgba(14,116,144,0.12), rgba(30,41,59,0.16) 42%, rgba(3,7,18,0.72) 100%)',
        }}
      >
        <div className="absolute inset-[7%] rounded-t-[46%] border border-cyan-200/30" />
        <div className="absolute inset-[15%] rounded-t-[44%] border border-violet-200/25" />
        <div
          className={cn(
            'absolute inset-[22%] rounded-t-[42%] border blur-[0.2px]',
            active
              ? 'border-yellow-100/60 bg-yellow-200/10 shadow-[inset_0_0_65px_rgba(250,204,21,0.18)]'
              : 'border-cyan-100/40 bg-cyan-400/5 shadow-[inset_0_0_55px_rgba(34,211,238,0.12)]',
          )}
        />
        <div className="absolute inset-x-0 bottom-[15%]">
          <div className="text-[10px] font-black tracking-[0.24em] text-cyan-100">
            레이드 관문
          </div>
          <div className="mt-1 font-display text-lg text-white">레이드 관문</div>
          <div className="mx-auto mt-2 max-w-[82%] truncate text-xs font-black text-yellow-100">
            {bossName}
          </div>
          {active && (
            <div className="mx-auto mt-3 w-max rounded-pill border border-yellow-200/50 bg-yellow-400/15 px-3 py-1.5 text-[10px] font-black text-yellow-100">
              클릭하여 전투 입장
            </div>
          )}
          {finished && (
            <div className="mx-auto mt-3 w-max rounded-pill border border-cyan-200/45 bg-cyan-500/10 px-3 py-1.5 text-[10px] font-black text-cyan-100">
              클릭하여 결과 확인
            </div>
          )}
        </div>
      </button>

      <div
        className={cn(
          'relative mx-auto -mt-2 w-[82%] rounded-card-md border px-4 py-2.5 backdrop-blur',
          active
            ? 'border-yellow-300/55 bg-yellow-950/70 text-yellow-100'
            : paused
              ? 'border-cyan-300/40 bg-cyan-950/70 text-cyan-100'
              : 'border-cyan-300/35 bg-[#07111f]/85 text-cyan-100',
        )}
      >
        <div className="text-xs font-black">
          {finished
            ? '🏁 레이드 종료'
            : active
              ? '⚔️ 전투가 시작되었습니다'
              : paused
                ? '⏸ 전투 일시정지'
                : '🌀 동료 집결 중'}
        </div>
        <div className="mt-1 text-[10px] font-bold text-white">
          {finished
            ? '관문을 통해 최종 결과를 확인할 수 있습니다.'
            : active
              ? '관문을 클릭해 보스 전투에 참가하세요.'
              : paused
                ? '관문에서 대화하며 재개를 기다려주세요.'
                : '선생님이 레이드를 시작하면 관문이 활성화됩니다.'}
        </div>
      </div>
    </div>
  );
}

function RaidLobbyAvatar({
  player,
  x,
  y,
  isMe,
  bubble,
}: {
  player: LobbyPlayer;
  x: number;
  y: number;
  isMe: boolean;
  bubble: RaidLobbyMessage | null;
}) {
  return (
    <div
      className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      {bubble && (
        <div className="absolute bottom-[calc(100%+8px)] left-1/2 z-40 w-max max-w-[190px] -translate-x-1/2 rounded-card-md border border-white/35 bg-white px-3 py-2 text-center text-xs font-black leading-4 text-[#07111f] shadow-xl">
          {bubble.message}
          <div className="absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-x-[6px] border-t-[7px] border-x-transparent border-t-white" />
        </div>
      )}

      <div
        className={cn(
          'relative flex h-[118px] w-[88px] items-end justify-center rounded-[42%_42%_18%_18%] border bg-black/15 px-1 pt-2 transition',
          isMe
            ? 'border-yellow-300/75 shadow-[0_0_28px_rgba(250,204,21,0.24)]'
            : 'border-cyan-200/25 shadow-[0_0_18px_rgba(34,211,238,0.10)]',
        )}
      >
        {player.equipped_character_image_url ? (
          <img
            src={player.equipped_character_image_url}
            alt={player.equipped_character_name ?? player.name}
            className="h-[112px] w-[82px] object-contain drop-shadow-[0_10px_10px_rgba(0,0,0,0.65)]"
            draggable={false}
          />
        ) : (
          <div className="mb-4 text-5xl">✦</div>
        )}
        {isMe && (
          <div className="absolute -right-2 -top-2 rounded-pill border border-yellow-200/70 bg-yellow-400 px-2 py-0.5 text-[9px] font-black text-[#241300]">
            ME
          </div>
        )}
      </div>

      <div className="mt-1.5 min-w-[110px] -translate-x-[11px] text-center">
        <div className="truncate text-[11px] font-black text-white">
          {player.brand_name || player.name}
        </div>
        <div className="mt-0.5 flex items-center justify-center gap-1 text-[9px] font-bold text-cyan-100">
          {player.guild_logo_url ? (
            <img
              src={player.guild_logo_url}
              alt=""
              className="h-3.5 w-3.5 rounded-full object-cover"
              draggable={false}
            />
          ) : (
            <span>◆</span>
          )}
          <span className="max-w-[92px] truncate">
            {player.guild_name || '무소속'}
          </span>
        </div>
      </div>
    </div>
  );
}

function GuildClusterTag({ cluster }: { cluster: GuildCluster }) {
  return (
    <div
      className="pointer-events-none absolute z-[5] -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${cluster.x}%`, top: `${Math.max(12, cluster.y - 14)}%` }}
    >
      <div className="flex items-center gap-1.5 rounded-pill border border-cyan-200/20 bg-[#07111f]/55 px-2.5 py-1 text-[9px] font-black text-cyan-100 backdrop-blur">
        {cluster.logoUrl ? (
          <img
            src={cluster.logoUrl}
            alt=""
            className="h-4 w-4 rounded-full object-cover"
            draggable={false}
          />
        ) : (
          <span>◆</span>
        )}
        <span className="max-w-[110px] truncate">{cluster.name}</span>
      </div>
    </div>
  );
}

function ChatMessage({
  message,
  isMe,
}: {
  message: RaidLobbyMessage;
  isMe: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-card-md border px-3 py-2',
        isMe
          ? 'border-yellow-300/30 bg-yellow-500/10'
          : 'border-cyan-300/20 bg-cyan-500/5',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            'truncate text-[10px] font-black',
            isMe ? 'text-yellow-100' : 'text-cyan-100',
          )}
        >
          {message.brand_name || message.student_name}
        </span>
        <span className="text-[9px] font-bold text-white/75">
          {formatTime(message.created_at)}
        </span>
      </div>
      <div className="mt-1 break-words text-xs font-bold leading-5 text-white">
        {message.message}
      </div>
    </div>
  );
}

function buildLobbyLayout(players: LobbyPlayer[]): {
  players: PositionedPlayer[];
  clusters: GuildCluster[];
} {
  const groups = new Map<string, LobbyPlayer[]>();

  players.forEach((player) => {
    const key =
      player.guild_id != null
        ? `guild:${player.guild_id}`
        : `unguilded:${player.student_id}`;
    const list = groups.get(key) ?? [];
    list.push(player);
    groups.set(key, list);
  });

  const entries = [...groups.entries()].sort(([, a], [, b]) =>
    String(a[0]?.guild_name ?? '무소속').localeCompare(
      String(b[0]?.guild_name ?? '무소속'),
      'ko',
    ),
  );

  const positioned: PositionedPlayer[] = [];
  const clusters: GuildCluster[] = [];

  entries.forEach(([key, members], groupIndex) => {
    const center =
      CLUSTER_CENTERS[groupIndex % CLUSTER_CENTERS.length] ??
      CLUSTER_CENTERS[0];
    const first = members[0];

    clusters.push({
      key,
      name: first?.guild_name || '무소속',
      logoUrl: first?.guild_logo_url ?? null,
      x: center.x,
      y: center.y,
    });

    members
      .sort((a, b) => a.student_id - b.student_id)
      .forEach((player, index) => {
        const offset =
          MEMBER_OFFSETS[index % MEMBER_OFFSETS.length] ??
          MEMBER_OFFSETS[0];
        const tier = Math.floor(index / MEMBER_OFFSETS.length);
        positioned.push({
          player,
          guildKey: key,
          x: center.x + offset.x + (tier % 2 === 0 ? -2 : 2),
          y: center.y + offset.y + tier * 8,
        });
      });
  });

  return { players: positioned, clusters };
}

function LobbyError({
  message,
  detail,
  onBack,
}: {
  message: string;
  detail?: string;
  onBack: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#06101c] p-5">
      <div className="w-full max-w-lg rounded-card-lg border border-red-300/40 bg-red-950/35 p-6 text-center">
        <div className="text-4xl">⚠️</div>
        <div className="mt-3 font-display text-lg text-white">{message}</div>
        {detail && (
          <div className="mt-2 break-all text-xs font-bold text-red-100">
            {detail}
          </div>
        )}
        <button
          type="button"
          onClick={onBack}
          className="mt-5 rounded-card-md border border-cyan-300/40 bg-cyan-500/10 px-4 py-2 text-xs font-black text-cyan-100"
        >
          홈으로 돌아가기
        </button>
      </div>
    </div>
  );
}

function elementLabel(element: RaidLobbySnapshotElement) {
  const labels: Record<RaidLobbySnapshotElement, string> = {
    FIRE: '🔥 화',
    WATER: '💧 수',
    WIND: '💫 풍',
    EARTH: '🪨 토',
    LIGHT: '✦ 빛',
    DARK: '☾ 암',
  };
  return labels[element];
}

type RaidLobbySnapshotElement =
  | 'FIRE'
  | 'WATER'
  | 'WIND'
  | 'EARTH'
  | 'LIGHT'
  | 'DARK';

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
