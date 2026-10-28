import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, Crown, Gauge, ImagePlus, Music2, Pause, Play, Plus, Upload, Volume2, VolumeX } from 'lucide-react';

type Scene = 'lobby' | 'characters' | 'game' | 'gameover';
type Character = { id: string; name: string; image: string };
type Profile = { nickname: string; characters: Character[]; activeId: string; maxDistance: number; totalMognetki: number };
type ObstacleKind = 'mognetka' | 'arrow';
type GameObject = { x: number; kind: ObstacleKind; scale: number; level: 'low' | 'high' };

const STORAGE_KEY = 'mognitke-runner-profile';
const MUTE_KEY = 'mognitke-runner-muted';
const BACKEND_URL = 'https://iglobrux-mognitke-bot.hf.space';

const tg = (window as any).Telegram?.WebApp;
const tgUser = tg?.initDataUnsafe?.user;
const DEFAULT_USER_ID = tgUser?.id || 99999; 
const DEFAULT_USERNAME = tgUser?.username || tgUser?.first_name || 'Игрок';

function CoinIcon({ size = 16 }: { size?: number }) { return <span className="coin-icon" style={{ width: size, height: size }} />; }

function readProfile(): Profile {
  const fallback: Profile = { nickname: DEFAULT_USERNAME, characters: [], activeId: '', maxDistance: 0, totalMognetki: 0 };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return { ...fallback, ...JSON.parse(stored) };
  } catch { /* ignore */ }
  return fallback;
}

function uid() { return Math.random().toString(36).slice(2, 9); }

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const profileRef = useRef<Profile>(readProfile());
  const [scene, setScene] = useState<Scene>('lobby');
  const [profile, setProfile] = useState<Profile>(profileRef.current);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(() => localStorage.getItem(MUTE_KEY) === '1');
  const [lastRun, setLastRun] = useState({ distance: 0, mognetki: 0 });
  const [runDistance, setRunDistance] = useState(0);
  const [coinCount, setCoinCount] = useState(0);
  const [editing, setEditing] = useState<{ id: string; name: string; image: string } | null>(null);
  const [toast, setToast] = useState('');

  const saveProfile = useCallback((next: Profile) => {
    profileRef.current = next;
    setProfile(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      localStorage.setItem(MUTE_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  const activeCharacter = profile.characters.find((c) => c.id === profile.activeId) || profile.characters[0];
  const activeImage = activeCharacter?.image || '';

  const beginRun = useCallback(() => {
    if (!activeImage) {
      setScene('characters');
      return;
    }
    setPaused(false);
    setCoinCount(0);
    setRunDistance(0);
    setScene('game');
    window.setTimeout(() => { if (audioRef.current && !muted) void audioRef.current.play().catch(() => undefined); }, 50);
  }, [activeImage, muted]);

  const flash = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2200); };

  const newCharacter = useCallback(() => {
    const id = uid();
    setEditing({ id, name: '', image: '' });
  }, []);

  const handleSpriteUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file || !editing) return;
    const reader = new FileReader(); reader.onload = () => setEditing({ ...editing, image: String(reader.result) }); reader.readAsDataURL(file);
  };

  const saveCharacter = useCallback(() => {
    if (!editing) return;
    if (!editing.image) { flash('Загрузи спрайт'); return; }
    if (!editing.name.trim()) { flash('Введи имя'); return; }
    const existing = profile.characters.find((c) => c.id === editing.id);
    const characters = existing
      ? profile.characters.map((c) => (c.id === editing.id ? { ...c, name: editing.name.trim(), image: editing.image } : c))
      : [...profile.characters, { id: editing.id, name: editing.name.trim(), image: editing.image }];
    const next = { ...profile, characters, activeId: profile.activeId || editing.id };
    saveProfile(next); setEditing(null);
  }, [editing, profile, saveProfile]);

  const activateCharacter = (id: string) => saveProfile({ ...profile, activeId: id });
  const deleteCharacter = (id: string) => {
    const characters = profile.characters.filter((c) => c.id !== id);
    const activeId = profile.activeId === id ? (characters[0]?.id || '') : profile.activeId;
    saveProfile({ ...profile, characters, activeId });
  };

  useEffect(() => {
    const audio = new Audio('/assets/audio/uroboros-beskonechnaia-zmeia.mp3');
    audio.loop = true; audio.volume = 0.4; audioRef.current = audio;
    return () => audio.pause();
  }, []);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.muted = muted;
    audioRef.current.volume = paused ? 0.15 : 0.4;
  }, [muted, paused]);

  useEffect(() => {
    if (scene !== 'game') return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const arrowImg = new Image(); arrowImg.src = '/assets/images/image.jpg';
    const coinFace = new Image(); coinFace.src = '/assets/images/image copy.png';
    const tiktok = new Image(); tiktok.src = '/assets/images/images.png';
    const player = new Image(); player.src = activeImage || '/assets/images/IMG_6863_1793015701804.jpeg';
    let width = 0; let height = 0; let last = performance.now(); let animation = 0;
    let distance = 0; let coins = 0; let speed = 6; let spawnTimer = 1.1; let lastDist = 0;
    let jump = 0; let jumpSpeed = 0; let held = false; let ducking = false; let lost = false;
    const objects: GameObject[] = [];
    let maxJump = 0;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth; height = window.innerHeight;
      canvas.width = width * ratio; canvas.height = height * ratio;
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      maxJump = Math.min(height * 0.42, 320);
    };
    const transparentAssets = new Map<HTMLImageElement, HTMLCanvasElement>();
    const cleanWhite = (image: HTMLImageElement) => {
      if (!image.complete || !image.naturalWidth || transparentAssets.has(image)) return;
      const buffer = document.createElement('canvas'); buffer.width = image.naturalWidth; buffer.height = image.naturalHeight;
      const bc = buffer.getContext('2d'); if (!bc) return;
      bc.drawImage(image, 0, 0);
      const px = bc.getImageData(0, 0, buffer.width, buffer.height);
      for (let i = 0; i < px.data.length; i += 4) if (px.data[i] > 238 && px.data[i + 1] > 238 && px.data[i + 2] > 238) px.data[i + 3] = 0;
      bc.putImageData(px, 0, 0); transparentAssets.set(image, buffer);
    };
    const sourceOf = (image: HTMLImageElement) => { cleanWhite(image); return transparentAssets.get(image) || image; };
    const groundY = () => height - Math.max(56, height * 0.12);
    
    const finish = async () => {
      lost = true;
      const finalDistance = Math.floor(distance);
      const result = { distance: finalDistance, mognetki: coins };
      const next = { ...profileRef.current, maxDistance: Math.max(profileRef.current.maxDistance, finalDistance), totalMognetki: profileRef.current.totalMognetki + coins };
      saveProfile(next); setLastRun(result); setScene('gameover');

      try {
        await fetch(`${BACKEND_URL}/api/save_score`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: DEFAULT_USER_ID,
            username: DEFAULT_USER_ID === 99999 ? 'Локальный Тест' : DEFAULT_USERNAME,
            distance: finalDistance,
            mognetki: coins
          })
        });
        console.log('Рекорд успешно сохранен на сервере!');
      } catch (err) {
        console.error('Ошибка сохранения на бэкенд:', err);
      }
    };

    const spawn = () => {
      const roll = Math.random();
      if (roll < 0.22) {
        objects.push({ x: width + 40, kind: 'mognetka', scale: 0.9 + Math.random() * 0.3, level: Math.random() < 0.6 ? 'high' : 'low' });
      } else {
        const scale = 0.7 + Math.random() * 0.8;
        objects.push({ x: width + 40, kind: 'arrow', scale, level: Math.random() < 0.72 ? 'low' : 'high' });
      }
    };
    const keyDown = (event: KeyboardEvent) => { if (event.code === 'Space' || event.key === 'ArrowUp') { held = true; event.preventDefault(); } if (event.key === 'ArrowDown') ducking = true; };
    const keyUp = (event: KeyboardEvent) => { if (event.code === 'Space' || event.key === 'ArrowUp') held = false; if (event.key === 'ArrowDown') ducking = false; };
    const pointerDown = () => { held = true; };
    const pointerUp = () => { held = false; };

    window.addEventListener('resize', resize); window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp); canvas.addEventListener('pointerdown', pointerDown); window.addEventListener('pointerup', pointerUp); resize();

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.04); last = now;
      const gy = groundY();
      if (!paused && !lost) {
        distance += speed * dt * 3; speed = Math.min(14, speed + dt * 0.1);
        const di = Math.floor(distance); if (di !== lastDist) { lastDist = di; setRunDistance(di); }
        spawnTimer -= dt; if (spawnTimer <= 0) { spawn(); spawnTimer = Math.max(0.35, 0.85 + Math.random() * 0.6 - speed * 0.015); }
        objects.forEach((object) => { object.x -= speed * 60 * dt; });
        while (objects.length && objects[0].x < -160) objects.shift();
        if (held && jump <= 0) jumpSpeed = 640;
        jump += jumpSpeed * dt;
        if (held && jump > maxJump) { jump = maxJump; jumpSpeed = 0; }
        jumpSpeed -= (held ? 620 : 2100) * dt;
        if (jump < 0) { jump = 0; jumpSpeed = 0; }
        const ph = ducking ? 30 : 52; const pw = 44; const px = 84; const py = gy - ph - jump;
        objects.forEach((object) => {
          if (object.kind === 'mognetka') {
            const r = 30 * object.scale; const cx = object.x; const cy = object.level === 'high' ? gy - 108 : gy - 38;
            if (px < cx + r && px + pw > cx - r && py < cy + r && py + ph > cy - r) { coins += 1; setCoinCount(coins); object.x = -200; }
          } else {
            const aw = 64 * object.scale; const ah = 52 * object.scale; const ax = object.x - aw / 2; const ay = object.level === 'high' ? gy - 52 - ah : gy - ah;
            if (px < ax + aw && px + pw > ax && py < ay + ah && py + ph > ay) finish();
          }
        });
      }
      ctx.clearRect(0, 0, width, height);
      const cycle = distance % 1600; const night = cycle >= 700 && cycle < 900;
      ctx.fillStyle = night ? '#202124' : '#ffffff'; ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = night ? '#f1f3f4' : '#d9dce1';
      for (let cloud = 0; cloud < 5; cloud += 1) { const cloudX = ((cloud * width / 2.5 - distance * 0.18) % (width + 160)) - 80; const cloudY = height * (0.16 + cloud * 0.05); ctx.beginPath(); ctx.ellipse(cloudX, cloudY, 52, 10, 0, 0, Math.PI * 2); ctx.fill(); }
      if (night) { ctx.fillStyle = '#f1f3f4'; for (let star = 0; star < 30; star += 1) { const starX = (star * 97) % width; const starY = 40 + ((star * 43) % Math.max(80, height * 0.34)); ctx.fillRect(starX, starY, 2, 2); } }
      ctx.strokeStyle = night ? '#f1f3f4' : '#535353'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(width, gy); ctx.stroke();
      ctx.strokeStyle = night ? 'rgba(241,243,244,.25)' : 'rgba(83,83,83,.25)'; ctx.lineWidth = 1;
      const groundOffset = (distance * 3) % 80;
      for (let index = -1; index < width / 80 + 1; index += 1) { const sx = index * 80 - groundOffset; ctx.beginPath(); ctx.moveTo(sx, gy + 8); ctx.lineTo(sx + 24, gy + 8); ctx.stroke(); }
      const logoOffset = (distance * 3) % width; ctx.globalAlpha = 0.7;
      for (let index = -1; index < 3; index += 1) { const lx = index * width - logoOffset; ctx.drawImage(sourceOf(tiktok), lx, gy + 6, width, 140); }
      ctx.globalAlpha = 1;
      objects.forEach((object) => {
        if (object.kind === 'mognetka') {
          const r = 30 * object.scale; const cx = object.x; const cy = object.level === 'high' ? gy - 108 : gy - 38;
          ctx.save(); ctx.translate(cx, cy); ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(coinFace, -r, -r, r * 2, r * 2); ctx.restore();
        } else {
          const aw = 64 * object.scale; const ah = 52 * object.scale; const cx = object.x; const ay = object.level === 'high' ? gy - 52 - ah : gy - ah;
          ctx.save(); ctx.translate(cx, ay + ah); ctx.rotate(Math.PI); ctx.drawImage(sourceOf(arrowImg), -aw / 2, 0, aw, ah); ctx.restore();
        }
      });
      const ph = ducking ? 30 : 52; const pw = 44; const px = 84; const py = gy - ph - jump;
      ctx.save(); ctx.translate(px, py); ctx.shadowColor = night ? '#f1f3f4' : '#9aa0a6'; ctx.shadowBlur = 6; ctx.drawImage(player, 0, 0, pw, ph); ctx.restore();
      animation = requestAnimationFrame(frame);
    };
    animation = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(animation); window.removeEventListener('resize', resize); window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); canvas.removeEventListener('pointerdown', pointerDown); window.removeEventListener('pointerup', pointerUp); };
  }, [paused, saveProfile, scene, activeImage]);

  const header = <header className="topbar"><strong>МОГНЕТКИ RUNNER</strong><div className="topbar-right"><button className="topbar-mute" onClick={toggleMute}>{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button></div></header>;

  if (scene === 'game') return (
    <main className="game-shell">
      <canvas ref={canvasRef} />
      <div className="game-top">
        <strong className="game-title">МОГНЕТКИ RUNNER</strong>
        <div className="game-distance"><Gauge size={22} /> {String(runDistance).padStart(5, '0')} м</div>
      </div>
      <div className="game-hud">
        <div className="hud-chip coin-chip"><CoinIcon size={30} /> <span>{coinCount}</span></div>
        <div className="hud-spacer" />
        <button className="icon-button" onClick={() => setPaused((value) => !value)}>{paused ? <Play size={18} /> : <Pause size={18} />}</button>
        <button className="icon-button" onClick={toggleMute}>{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
      </div>
      <button className="duck-button" onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' })); }} onPointerUp={(e) => { e.stopPropagation(); e.preventDefault(); window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown' })); }} onPointerLeave={() => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown' }))}>присесть</button>
      {paused && <div className="pause-card"><span>ПАУЗА</span><h2>Передышка</h2><p>Удерживай экран или пробел, чтобы зависнуть в воздухе</p><button className="primary-button" onClick={() => setPaused(false)}>Продолжить <ChevronRight size={18} /></button></div>}
    </main>
  );

  return (
    <main className="app-shell">
      {header}
      {scene === 'lobby' && (
        <section className="lobby scene-content">
          <div className="hero-stats">
            <div className="stat-big"><Crown size={20} /><div><span>РЕКОРД</span><strong>{profile.maxDistance} м</strong></div></div>
            <div className="stat-big"><CoinIcon size={34} /><div><span>МОГНЕТКИ</span><strong>{profile.totalMognetki}</strong></div></div>
          </div>
          <div className="runner-preview">
            <div className="preview-road" />
            {activeCharacter ? <img className="preview-hero-img" src={activeCharacter.image} alt={activeCharacter.name} /> : <div className="preview-empty"><Upload size={40} /></div>}
            <span className="preview-name">{activeCharacter?.name || 'Нет персонажа'}</span>
          </div>
          <div className="hero-actions">
            <button className="primary-button" onClick={beginRun}>В Бой! <ChevronRight size={18} /></button>
            <button className="secondary-button" onClick={() => setScene('characters')}><ImagePlus size={18} /> Персонажи</button>
          </div>
        </section>
      )}
      {scene === 'characters' && !editing && (
        <section className="scene-content characters">
          <button className="back-button" onClick={() => setScene('lobby')}><ArrowLeft size={18} /> Назад</button>
          <span className="eyebrow">МОИ ПЕРСОНАЖИ</span>
          <div className="char-grid">
            {profile.characters.map((c) => (
              <div key={c.id} className={`char-card ${c.id === profile.activeId ? 'active' : ''}`}>
                <div className="char-preview">{c.image && <img src={c.image} alt={c.name} />}</div>
                <strong>{c.name}</strong>
                <div className="char-actions">
                  {c.id === profile.activeId ? <span className="active-tag">АКТИВЕН</span> : <button className="mini-button" onClick={() => activateCharacter(c.id)}>Выбрать</button>}
                  <button className="mini-button" onClick={() => setEditing({ id: c.id, name: c.name, image: c.image })}>Изменить</button>
                  <button className="mini-button danger" onClick={() => deleteCharacter(c.id)}>Удалить</button>
                </div>
              </div>
            ))}
            <button className="char-card buy-slot" onClick={newCharacter}>
              <Plus size={32} />
              <strong>Новый персонаж</strong>
              <span className="slot-price">Бесплатно</span>
            </button>
          </div>
          <div className="coin-balance"><CoinIcon size={30} /> Баланс: {profile.totalMognetki} МОГнеток</div>
        </section>
      )}
      {scene === 'characters' && editing && (
        <section className="scene-content characters">
          <button className="back-button" onClick={() => setEditing(null)}><ArrowLeft size={18} /> Назад</button>
          <span className="eyebrow">{profile.characters.find((c) => c.id === editing.id) ? 'РЕДАКТИРОВАНИЕ' : 'НОВЫЙ ПЕРСОНАЖ'}</span>
          <div className="create-card">
            <div className="create-preview">{editing.image ? <img src={editing.image} alt="спрайт" /> : <Upload size={40} />}</div>
            <label className="upload-button"><Upload size={16} /> Загрузить спрайт<input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleSpriteUpload} /></label>
            <label className="field-label">ИМЯ ПЕРСОНАЖА<input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Введите имя" maxLength={18} /></label>
            <button className="primary-button wide" onClick={saveCharacter}>Сохранить <ChevronRight size={18} /></button>
          </div>
        </section>
      )}
      {scene === 'gameover' && (
        <section className="scene-content gameover">
          <div className="over-badge"><CoinIcon size={52} /></div>
          <span className="eyebrow">ЗАБЕГ ЗАВЕРШЁН</span>
          <div className="result-card">
            <div><span>ДИСТАНЦИЯ</span><strong>{lastRun.distance}<small> м</small></strong></div>
            <div><span>МОГНЕТКИ</span><strong>{lastRun.mognetki}</strong></div>
          </div>
          <button className="primary-button wide" onClick={beginRun}>Повторить <ChevronRight size={18} /></button>
          <button className="secondary-button wide" onClick={() => setScene('lobby')}>В меню</button>
        </section>
      )}
      {toast && <div className="toast">{toast}</div>}
      <footer className="footer-note"><Music2 size={13} /> Удержание — прыжок · кнопка «присесть» — приседание</footer>
    </main>
  );
}

export default App;
