import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import logo from './logo.svg';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { ConnectionProvider, WalletProvider, useWallet } from '@solana/wallet-adapter-react';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl, Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import confetti from 'canvas-confetti';
import '@solana/wallet-adapter-react-ui/styles.css';

const API_BASE = 'https://adona.onrender.com';

type Direction = 'up' | 'down' | 'left' | 'right';
type Screen = 'loading' | 'home' | 'game' | 'store' | 'leaderboard' | 'pvp' | 'credits';

interface Threat {
  id: number;
  direction: Direction;
  progress: number;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

interface Powerup {
  id: string;
  name: string;
  description: string;
  price: number;
  duration: number;
  accentColor: string;
  icon: string;
  active?: boolean;
  timeLeft?: number;
  usesLeft?: number;
}

interface Character {
  id: string;
  name: string;
  price: number;
  image: string;
  powerups: string[];
  isFree: boolean;
}

interface UserData {
  wallet: string;
  selectedCharacter: string;
  purchasedCharacters: string[];
  purchasedPowerups: string[];
  highScore: number;
  totalGames: number;
}

interface AssetCache {
  characters: { [key: string]: string };
  powerups: { [key: string]: string };
  audio: { [key: string]: HTMLAudioElement };
}

const DeflectGame: React.FC = () => {
  const { publicKey, sendTransaction } = useWallet();
  const [screen, setScreen] = useState<Screen>('loading');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [assets, setAssets] = useState<AssetCache>({ characters: {}, powerups: {}, audio: {} });
  
  // Game state
  const [gameState, setGameState] = useState<'playing' | 'gameover'>('playing');
  const [score, setScore] = useState(0);
  const [threats, setThreats] = useState<Threat[]>([]);
  const [combo, setCombo] = useState(0);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [shake, setShake] = useState(0);
  const [slowMo, setSlowMo] = useState(false);
  const [perfectFlash, setPerfectFlash] = useState(false);
  
  // User & Store
  const [userData, setUserData] = useState<UserData | null>(null);
  const [allCharacters, setAllCharacters] = useState<{ [key: string]: Character }>({});
  const [allPowerups, setAllPowerups] = useState<{ [key: string]: Powerup }>({});
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
  const [activePowerups, setActivePowerups] = useState<Powerup[]>([]);
  const [currentPowerup, setCurrentPowerup] = useState<Powerup | null>(null);
  const [solPrice, setSolPrice] = useState(100);
  const [viewingItem, setViewingItem] = useState<(Character | Powerup) | null>(null);
  const [viewingItemType, setViewingItemType] = useState<'character' | 'powerup' | null>(null);
  
  // Leaderboard
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  
  // PVP
  const [pvpSocket, setPvpSocket] = useState<WebSocket | null>(null);
  const [pvpState, setPvpState] = useState<any>(null);

  // UI
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [realityWarpMode, setRealityWarpMode] = useState(false);
  const [characterPosition, setCharacterPosition] = useState({ x: 50, y: 50 });
  const [timeRemaining, setTimeRemaining] = useState('');
  const [isAirdropModalOpen, setIsAirdropModalOpen] = useState(false);
  
  // Refs
  const gameLoopRef = useRef<number | undefined>(undefined);
  const threatIdRef = useRef(0);
  const particleIdRef = useRef(0);
  const lastSpawnRef = useRef(0);
  const waveRef = useRef(0);
  const lastUpdateRef = useRef(performance.now());
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const godReviveUsesRef = useRef(0);
  const shadowCloneActiveRef = useRef(false);
  const absorbActiveRef = useRef(false);
  const reviveTimeRef = useRef(0);

  useEffect(() => {
    const styleSheet = document.createElement("style");
    styleSheet.type = "text/css";
    styleSheet.innerText = `
      @keyframes pulse {
        0%, 100% { transform: translate(-50%, -50%) scale(1); }
        50% { transform: translate(-50%, -50%) scale(1.1); }
      }
      @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
      }
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      @keyframes jitter {
        0%, 100% { transform: translate(0, 0); }
        25% { transform: translate(1px, -1px); }
        50% { transform: translate(-1px, 1px); }
        75% { transform: translate(1px, 1px); }
      }
    `;
    document.head.appendChild(styleSheet);

    const targetDate = new Date('2026-01-25T00:00:00Z').getTime();
    const interval = setInterval(() => {
      const now = new Date().getTime();
      const distance = targetDate - now;
      const days = Math.floor(distance / (1000 * 60 * 60 * 24));
      const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((distance % (1000 * 60)) / 1000);
      setTimeRemaining(`${days}d ${hours}h ${minutes}m ${seconds}s`);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (screen === 'pvp' && publicKey && !pvpSocket) {
      const ws = new WebSocket(`wss://adona.onrender.com/ws/pvp/${publicKey.toString()}`);

      ws.onopen = () => {
        console.log('PVP WebSocket connection established.');
        showNotification('Connecting to PvP...', 'info');
        ws.send(JSON.stringify({ type: 'join_queue' }));
        setPvpSocket(ws);
      };

      ws.onmessage = (event) => {
        console.log('Received PvP data:', event.data);
        const data = JSON.parse(event.data);
        setPvpState(data);

        if (data.type === 'threat_spawn') {
          setThreats(prev => [...prev, { ...data.threat, progress: 0 }]);
        }
        if (data.type === 'score_update') {
          console.log('Score Update:', data);
        }
      };

      ws.onerror = (error) => {
        console.error('PVP WebSocket error:', error);
        showNotification('PVP connection error.', 'error');
        setScreen('home');
      };

      ws.onclose = (event) => {
        console.log('PVP WebSocket connection closed.', event);
        showNotification('Disconnected from PvP.', 'info');
        setPvpSocket(null);
        setPvpState(null);
        setScreen('home');
      };
    }

    return () => {
      if (pvpSocket && screen !== 'pvp') {
        pvpSocket.close();
      }
    };
  }, [screen, publicKey, pvpSocket]);

  useEffect(() => {
    loadAllAssets();
  }, []);

  useEffect(() => {
    if (publicKey) {
      fetchUserData();
      fetchSolPrice();
    }
  }, [publicKey]);

  const loadAllAssets = async () => {
    try {
      setLoadingProgress(10);
      
      const [charsRes, powerupsRes] = await Promise.all([
        fetch(`${API_BASE}/api/characters`),
        fetch(`${API_BASE}/api/powerups`)
      ]);
      
      const chars = await charsRes.json();
      const pows = await powerupsRes.json();
      
      setAllCharacters(chars);
      setAllPowerups(pows);
      setLoadingProgress(30);
      
      const charImages: { [key: string]: string } = {};
      const charKeys = Object.keys(chars);
      for (let i = 0; i < charKeys.length; i++) {
        const key = charKeys[i];
        const char = chars[key];
        const img = new Image();
        img.src = `${API_BASE}/api/assets/character/${char.image}`;
        await img.decode();
        charImages[key] = img.src;
        setLoadingProgress(30 + (i / charKeys.length) * 30);
      }
      
      const powImages: { [key: string]: string } = {};
      const powKeys = Object.keys(pows);
      for (let i = 0; i < powKeys.length; i++) {
        const key = powKeys[i];
        const pow = pows[key];
        const img = new Image();
        img.src = `${API_BASE}/api/assets/powerup/${pow.icon}`;
        await img.decode();
        powImages[key] = img.src;
        setLoadingProgress(60 + (i / powKeys.length) * 20);
      }
      
      const audioFiles: { [key: string]: HTMLAudioElement } = {};
      const audioNames = ['lose-soundtrack.mp3', 'upgrade-soundtrack.mp3', 'win-soundtrack.mp3'];
      for (let i = 0; i < audioNames.length; i++) {
        const name = audioNames[i];
        const audio = new Audio(`${API_BASE}/api/assets/audio/${name}`);
        audio.preload = 'auto';
        await new Promise(resolve => {
          audio.addEventListener('canplaythrough', resolve, { once: true });
        });
        audioFiles[name.replace('.mp3', '')] = audio;
        setLoadingProgress(80 + (i / audioNames.length) * 20);
      }
      
      setAssets({ characters: charImages, powerups: powImages, audio: audioFiles });
      setLoadingProgress(100);
      
      setTimeout(() => setScreen('home'), 500);
    } catch (error) {
      console.error('Asset loading error:', error);
      showNotification('Failed to load assets', 'error');
      setTimeout(() => setScreen('home'), 1000);
    }
  };

  const fetchUserData = async () => {
    if (!publicKey) return;
    try {
      const res = await fetch(`${API_BASE}/api/user/${publicKey.toString()}`);
      const data = await res.json();
      setUserData(data);
      
      const char = allCharacters[data.selectedCharacter];
      if (char) setSelectedCharacter(char);
    } catch (error) {
      console.error('Failed to fetch user data:', error);
    }
  };

  const fetchSolPrice = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/sol-price`);
      const data = await res.json();
      setSolPrice(data.sol_usd);
    } catch (error) {
      console.error('Failed to fetch SOL price:', error);
    }
  };

  const fetchLeaderboard = async () => {
    setLeaderboardLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/leaderboard`);
      const data = await res.json();
      setLeaderboard(data.leaderboard);
    } catch (error) {
      console.error('Failed to fetch leaderboard:', error);
    } finally {
      setLeaderboardLoading(false);
    }
  };

  const selectRandomPowerups = () => {
    if (!selectedCharacter || !userData) return;
    
    const available: Powerup[] = [];
    const native = selectedCharacter.powerups.map(id => allPowerups[id]).filter(Boolean);
    const purchased = userData.purchasedPowerups.map(id => allPowerups[id]).filter(Boolean);
    
    if (native.length > 0) {
      const randomNative = native[Math.floor(Math.random() * native.length)];
      available.push({ ...randomNative });
    }
    
    const shuffled = [...purchased].sort(() => Math.random() - 0.5);
    for (let i = 0; i < Math.min(2, shuffled.length); i++) {
      available.push({ ...shuffled[i] });
    }
    
    available.forEach(p => {
      p.active = false;
      if (p.id === 'god_revive') p.usesLeft = 3;
      if (p.id === 'infinite') p.usesLeft = 999;
      if (p.id === 'shadow_clone') p.usesLeft = 1;
    });
    
    setActivePowerups(available);
  };

  const activatePowerup = (powerup: Powerup) => {
    if (powerup.active) return;
    
    vibrate(200);
    playAudio('upgrade-soundtrack');
    
    const updated = { ...powerup, active: true };
    
    if (powerup.duration > 0) {
      updated.timeLeft = powerup.duration;
    }
    
    setCurrentPowerup(updated);
    setActivePowerups(prev => prev.map(p => p.id === powerup.id ? updated : p));
    
    if (powerup.id === 'reality_warp') {
      setRealityWarpMode(true);
    } else if (powerup.id === 'shadow_clone') {
      shadowCloneActiveRef.current = true;
    } else if (powerup.id === 'absorb') {
      absorbActiveRef.current = true;
    } else if (powerup.id === 'god_revive') {
      godReviveUsesRef.current = 3;
    } else if (powerup.id === 'infinite') {
      godReviveUsesRef.current = 999;
    }
    
    document.body.style.boxShadow = `inset 0 0 100px ${powerup.accentColor}`;
    setTimeout(() => {
      document.body.style.boxShadow = '';
    }, 1000);
  };

  const deactivatePowerup = (powerupId: string) => {
    setActivePowerups(prev => prev.filter(p => p.id !== powerupId));

    if (powerupId === 'reality_warp') {
      setRealityWarpMode(false);
      setCharacterPosition({ x: 50, y: 50 });
    } else if (powerupId === 'absorb') {
      absorbActiveRef.current = false;
    } else if (powerupId === 'shadow_clone') {
      shadowCloneActiveRef.current = false;
    }

    if (currentPowerup?.id === powerupId) {
      setCurrentPowerup(null);
    }
  };

  const startGame = () => {
    setGameState('playing');
    setScore(0);
    setThreats([]);
    setCombo(0);
    setParticles([]);
     waveRef.current = 0;
     lastSpawnRef.current = performance.now();
    threatIdRef.current = 0;
     godReviveUsesRef.current = 0;
     shadowCloneActiveRef.current = false;
     absorbActiveRef.current = false;
     reviveTimeRef.current = 0;
     setRealityWarpMode(false);
    setCharacterPosition({ x: 50, y: 50 });
    setCurrentPowerup(null);
    selectRandomPowerups();
    setScreen('game');
  };

  const gameOver = async () => {
    const godRevive = activePowerups.find(p => (p.id === 'god_revive' || p.id === 'infinite') && p.usesLeft && p.usesLeft > 0);
    if (godRevive) {
      const newUses = (godRevive.usesLeft || 0) - 1;
      setActivePowerups(prev => prev.map(p =>
        p.id === godRevive.id ? { ...p, usesLeft: newUses } : p
      ).filter(p => p.id !== godRevive.id || newUses > 0));
      reviveTimeRef.current = performance.now() + 1000;
      vibrate([100, 50, 100]);
      showNotification('REVIVED!', 'success');
      return;
    }

    setSlowMo(true);
    playAudio('lose-soundtrack');

    setTimeout(async () => {
      setSlowMo(false);
      setGameState('gameover');

      if (publicKey && score > 0) {
        await submitScore();
      }

      if (score > (userData?.highScore || 0)) {
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 }
        });
        playAudio('win-soundtrack');
      }
    }, 500);
  };

  const submitScore = async () => {
    if (!publicKey || !selectedCharacter) return;
    
    try {
      await fetch(`${API_BASE}/api/leaderboard/score?wallet=${publicKey.toString()}&score=${score}&character=${selectedCharacter.id}`, {
        method: 'POST'
      });
      await fetchUserData();
      showNotification('Score saved!', 'success');
    } catch (error) {
      console.error('Failed to submit score:', error);
    }
  };

  const purchaseItem = async (itemId: string, itemType: 'character' | 'powerup', priceUSD: number) => {
    if (!publicKey) {
      showNotification('Please connect wallet', 'error');
      return;
    }
    
    try {
      const priceSol = priceUSD / solPrice;
      const connection = new Connection(clusterApiUrl('devnet'));
      
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey('DvY73fC74Ny33Zu3ScA62VCSwrz1yV8kBysKu3rnLjvD'),
          lamports: Math.floor(priceSol * LAMPORTS_PER_SOL)
        })
      );
      
      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, 'confirmed');
      
      await fetch(`${API_BASE}/api/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: publicKey.toString(),
          item: itemId,
          itemType,
          txHash: signature
        })
      });
      
      showNotification('Purchase successful!', 'success');
      playAudio('upgrade-soundtrack');
      vibrate(200);
      confetti({ particleCount: 50, spread: 60 });
      
      await fetchUserData();
    } catch (error) {
      console.error('Purchase error:', error);
      showNotification('Purchase failed', 'error');
      vibrate([100, 50, 100, 50, 100]);
    }
  };

  const showNotification = (message: string, type: 'success' | 'error' | 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const vibrate = (pattern: number | number[]) => {
    if ('vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  };

  const playAudio = (name: string) => {
    const audio = assets.audio[name];
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(e => console.log('Audio play failed:', e));
    }
  };

  const deflect = (direction: Direction) => {
    if (screen === 'pvp' && pvpSocket) {
      pvpSocket.send(JSON.stringify({ type: 'action', payload: { direction } }));
      return;
    }

    if (gameState !== 'playing' || realityWarpMode) return;

    const threat = threats.find(t => t.direction === direction && t.progress > 0.6);
    
    if (threat) {
      const isPerfect = threat.progress > 0.85;
      
      const absorb = activePowerups.find(p => p.id === 'absorb' && p.active);
      let points = isPerfect ? 15 : 10;
      if (absorb) {
        points = Math.floor(points * 1.1);
      }
      
      const newCombo = isPerfect ? combo + 1 : 0;
      const multiplier = Math.min(newCombo, 4);
      
      setScore(prev => prev + points * (multiplier || 1));
      setCombo(newCombo);
      setThreats(prev => prev.filter(t => t.id !== threat.id));
      
      setShake(10);
      setTimeout(() => setShake(0), 100);
      vibrate(50);

      const positions = {
        up: { x: 50, y: 20 },
        down: { x: 50, y: 80 },
        left: { x: 20, y: 50 },
        right: { x: 80, y: 50 }
      };
      const pos = positions[direction];
      
      const color = absorb ? '#00ff00' : '#00f0ff';
      createParticles(pos.x, pos.y, color);

      if (isPerfect) {
        setPerfectFlash(true);
        setTimeout(() => setPerfectFlash(false), 200);
      }
    }
  };

  const createParticles = (x: number, y: number, color: string) => {
    const newParticles: Particle[] = [];
    for (let i = 0; i < 12; i++) {
      const angle = (Math.PI * 2 * i) / 12;
      const speed = 2 + Math.random() * 3;
      newParticles.push({
        id: particleIdRef.current++,
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        color
      });
    }
    setParticles(prev => [...prev, ...newParticles]);
  };

  const handleScreenTap = (e: React.MouseEvent) => {
    if (!realityWarpMode) return;
    
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    
    setCharacterPosition({ x, y });
    vibrate(30);
  };

  useEffect(() => {
    if (screen !== 'game' || gameState !== 'playing') return;

    const loop = () => {
      const now = performance.now();
      const delta = (now - lastUpdateRef.current) / 1000;
      lastUpdateRef.current = now;
      
      const interval = Math.max(800, 1500 - waveRef.current * 50);
      if (now - lastSpawnRef.current > interval) {
        const directions: Direction[] = ['up', 'down', 'left', 'right'];
        const direction = directions[Math.floor(Math.random() * directions.length)];
        
        setThreats(prev => [...prev, {
          id: threatIdRef.current++,
          direction,
          progress: 0
        }]);
        
        lastSpawnRef.current = now;
        waveRef.current++;
      }

      setThreats(prev => {
        const speed = slowMo ? 0.005 : 0.015;
        const intangible = activePowerups.find(p => p.id === 'intangibility' && p.active);
        const invincible = intangible || absorbActiveRef.current || realityWarpMode || (reviveTimeRef.current > 0 && now < reviveTimeRef.current);

        if (reviveTimeRef.current > 0 && now >= reviveTimeRef.current) {
          reviveTimeRef.current = 0;
        }

        const updated = prev.map(t => ({
          ...t,
          progress: t.progress + speed
        }));

        const missed = updated.find(t => t.progress >= 1);
        if (missed && !invincible) {
          if (shadowCloneActiveRef.current) {
            shadowCloneActiveRef.current = false;
            reviveTimeRef.current = now + 1000;
            vibrate([100, 50, 100]);
            showNotification('Shadow Clone took the hit!', 'success');
            deactivatePowerup('shadow_clone');
            return updated.filter(t => t.id !== missed.id);
          } else {
            gameOver();
            return updated.filter(t => t.id !== missed.id);
          }
        }

        return updated.filter(t => t.progress < 1);
      });

      setParticles(prev => {
        return prev
          .map(p => ({
            ...p,
            x: p.x + p.vx,
            y: p.y + p.vy,
            life: p.life - 0.02
          }))
          .filter(p => p.life > 0);
      });
      
      setActivePowerups(prev => prev.map(p => {
        if (p.active && p.timeLeft && p.timeLeft > 0) {
          const newTime = p.timeLeft - delta;
          if (newTime <= 0) {
            deactivatePowerup(p.id);
            return { ...p, active: false, timeLeft: 0 };
          }
          return { ...p, timeLeft: newTime };
        }
        return p;
      }));

      gameLoopRef.current = requestAnimationFrame(loop);
    };

    gameLoopRef.current = requestAnimationFrame(loop);
    return () => {
      if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
    };
  }, [screen, gameState, slowMo, activePowerups, realityWarpMode]);

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;
    
    if (Math.abs(dx) > 50 || Math.abs(dy) > 50) {
      if (Math.abs(dx) > Math.abs(dy)) {
        deflect(dx > 0 ? 'right' : 'left');
      } else {
        deflect(dy > 0 ? 'down' : 'up');
      }
    }
    
    touchStartRef.current = null;
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (screen !== 'game' || gameState !== 'playing') return;
      
      const keyMap: Record<string, Direction> = {
        ArrowUp: 'up', w: 'up', W: 'up',
        ArrowDown: 'down', s: 'down', S: 'down',
        ArrowLeft: 'left', a: 'left', A: 'left',
        ArrowRight: 'right', d: 'right', D: 'right'
      };
      
      const direction = keyMap[e.key];
      if (direction) {
        e.preventDefault();
        deflect(direction);
      }
      
      if (e.key === '1' && activePowerups[0] && !activePowerups[0].active) {
        activatePowerup(activePowerups[0]);
      } else if (e.key === '2' && activePowerups[1] && !activePowerups[1].active) {
        activatePowerup(activePowerups[1]);
      } else if (e.key === '3' && activePowerups[2] && !activePowerups[2].active) {
        activatePowerup(activePowerups[2]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [screen, gameState, activePowerups, deflect]);

  const renderLoading = () => (
    <div style={styles.loadingScreen}>
      <img src={`${API_BASE}/assets/images/logo.png`} alt="deflect.fun" style={styles.loadingLogo} />
      <div style={styles.loadingBar}>
        <div style={{ ...styles.loadingProgress, width: `${loadingProgress}%` }} />
      </div>
      <p style={styles.loadingText}>{loadingProgress}%</p>
    </div>
  );

  const renderHome = () => (
    <div style={styles.homeScreen}>
      <div style={styles.glassCard}>
        <h1 style={styles.homeTitle}>deflect.fun</h1>
        <p style={styles.homeSubtitle}>Swipe to survive. Collect powerups. Dominate.</p>
        
        <div style={styles.walletContainer}>
          <WalletMultiButton />
        </div>
        
        {publicKey && (
          <>
            <div style={styles.buttonContainer}>
              <div style={styles.buttonRow}>
                <button style={{...styles.homeButton, flex: 1}} onClick={startGame}>PLAY SOLO</button>
                <button style={{...styles.homeButton, ...styles.secondaryButton, flex: 1}} onClick={() => setScreen('pvp')}>PLAY PVP</button>
              </div>
              <button style={{...styles.homeButton, ...styles.secondaryButton, width: '100%'}} onClick={() => setScreen('store')}>STORE</button>
              <div style={styles.buttonRow}>
                <button style={{...styles.homeButton, ...styles.secondaryButton, flex: 1}} onClick={() => {
                  fetchLeaderboard();
                  setScreen('leaderboard');
                }}>LEADERBOARD</button>
                <button style={{...styles.homeButton, ...styles.secondaryButton, flex: 1}} onClick={() => setScreen('credits')}>CREDITS</button>
              </div>
            </div>
            
            {userData && userData.highScore > 0 && (
              <div style={styles.statsCard}>
                <div>High Score: <span style={styles.statValue}>{userData.highScore}</span></div>
                <div>Games Played: <span style={styles.statValue}>{userData.totalGames}</span></div>
              </div>
            )}
          </>
        )}
        
        {!publicKey && (
          <p style={styles.connectPrompt}>Connect wallet to play</p>
        )}

        <div style={styles.countdownSection}>
          <h3 style={styles.countdownTitle}>Season 1 Ends In:</h3>
          <p style={styles.countdownTimer}>{timeRemaining}</p>
          <button style={styles.learnMoreButton} onClick={() => setIsAirdropModalOpen(true)}>
            Learn More
          </button>
        </div>
      </div>
    </div>
  );

  const renderGame = () => {
    const intangible = activePowerups.find(p => p.id === 'intangibility' && p.active);
    const absorb = activePowerups.find(p => p.id === 'absorb' && p.active);
    const invincible = intangible || absorb;
    
    return (
      <div style={styles.gameContainer}>
        <div 
          style={{ ...styles.gameArea, transform: `translate(${shake}px, 0)` }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onClick={handleScreenTap}
        >
          <div style={{
            ...styles.player,
            left: `${characterPosition.x}%`,
            top: `${characterPosition.y}%`,
             opacity: invincible ? 0.3 : 1,
             boxShadow: absorb ? '0 0 30px #00ff00' : (combo > 0 ? '0 0 30px #00f0ff' : '0 0 15px #00f0ff'),
            backgroundImage: selectedCharacter ? `url(${assets.characters[selectedCharacter.id]})` : 'none',
            backgroundSize: 'cover',
            backgroundPosition: 'center'
          }} />
          
          {shadowCloneActiveRef.current && (
            <div style={{
              ...styles.player,
              left: '80%',
              top: '20%',
              opacity: 0.5,
              backgroundImage: selectedCharacter ? `url(${assets.characters[selectedCharacter.id]})` : 'none',
              backgroundSize: 'cover'
            }} />
          )}

          {threats.map(threat => {
            const positions = {
              up: { top: `${threat.progress * 50}%`, left: '50%' },
              down: { top: `${100 - threat.progress * 50}%`, left: '50%' },
              left: { left: `${threat.progress * 50}%`, top: '50%' },
              right: { left: `${100 - threat.progress * 50}%`, top: '50%' }
            };

            return (
              <div
                key={threat.id}
                style={{
                  ...styles.threat,
                  ...positions[threat.direction],
                  transform: 'translate(-50%, -50%)',
                  opacity: slowMo ? 0.5 : 1
                }}
              />
            );
          })}

          {particles.map(p => (
            <div
              key={p.id}
              style={{
                position: 'absolute',
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: '4px',
                height: '4px',
                backgroundColor: p.color,
                borderRadius: '50%',
                opacity: p.life,
                pointerEvents: 'none'
              }}
            />
          ))}

          <div style={{ ...styles.arrow, top: '5%', left: '50%', transform: 'translate(-50%, 0) rotate(180deg)' }}>▲</div>
          <div style={{ ...styles.arrow, bottom: '5%', left: '50%', transform: 'translate(-50%, 0)' }}>▲</div>
          <div style={{ ...styles.arrow, left: '5%', top: '50%', transform: 'translate(0, -50%) rotate(-90deg)' }}>▲</div>
          <div style={{ ...styles.arrow, right: '5%', top: '50%', transform: 'translate(0, -50%) rotate(90deg)' }}>▲</div>

          {perfectFlash && <div style={styles.perfectFlash} />}
          
          {currentPowerup && currentPowerup.active && (
            <div style={styles.powerupActive}>
              {currentPowerup.name.toUpperCase()} ACTIVE!
            </div>
          )}
          
          {realityWarpMode && (
            <div style={styles.realityWarpOverlay}>
              <p>REALITY WARP - TAP TO TELEPORT</p>
              <button style={styles.exitWarpButton} onClick={() => deactivatePowerup('reality_warp')}>
                EXIT WARP
              </button>
            </div>
          )}
        </div>

        <div style={styles.hud}>
          <div style={styles.score}>
            <div style={styles.scoreLabel}>SCORE</div>
            <div style={styles.scoreValue}>{score}</div>
          </div>
          <div style={styles.highScore}>
            <div style={styles.scoreLabel}>HIGH</div>
            <div style={styles.scoreValue}>{userData?.highScore || 0}</div>
          </div>
          {combo > 0 && (
            <div style={styles.combo}>
              COMBO x{Math.min(combo, 4)}
            </div>
          )}
          
          {currentPowerup && currentPowerup.timeLeft && currentPowerup.timeLeft > 0 && (
            <div style={styles.powerupTimer}>
              {currentPowerup.name}: {Math.ceil(currentPowerup.timeLeft)}s
            </div>
          )}
        </div>

        <div style={styles.powerupContainer}>
          {activePowerups.map((p, i) => (
            <button
              key={i}
              style={{
                ...styles.powerupButton,
                borderColor: p.accentColor,
                opacity: p.active ? 0.5 : 1,
                backgroundImage: `url(${assets.powerups[p.id]})`,
                backgroundSize: 'contain',
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'center'
              }}
              onClick={() => !p.active && activatePowerup(p)}
              disabled={p.active}
            >
              {p.usesLeft !== undefined && p.usesLeft > 0 && (
                <span style={styles.powerupUses}>{p.usesLeft}</span>
              )}
            </button>
          ))}
        </div>

        {gameState === 'gameover' && (
          <div style={styles.overlay}>
            <div style={styles.glassCard}>
              <h2 style={styles.gameOverTitle}>GAME OVER</h2>
              <div style={styles.finalScore}>{score}</div>
              {score >= (userData?.highScore || 0) && score > 0 && (
                <div style={styles.newHighScore}>NEW HIGH SCORE! 🎉</div>
              )}
              <button style={styles.homeButton} onClick={startGame}>
                PLAY AGAIN
              </button>
              <button style={{ ...styles.homeButton, ...styles.secondaryButton }} onClick={() => setScreen('home')}>
                HOME
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderItemDetails = () => {
    if (!viewingItem) return null;

    const isCharacter = viewingItemType === 'character';
    const imageSrc = isCharacter 
      ? assets.characters[viewingItem.id] 
      : assets.powerups[viewingItem.id];

    return (
      <div style={styles.detailsOverlay} onClick={() => setViewingItem(null)}>
        <div style={styles.detailsDrawer} onClick={e => e.stopPropagation()}>
          <button style={styles.closeDetailsButton} onClick={() => setViewingItem(null)}>×</button>
          
          <div style={styles.detailsContent}>
            <div style={{
              ...styles.detailsImage,
              backgroundImage: `url(${imageSrc})`,
              ...(isCharacter ? {} : { backgroundSize: 'contain', border: `2px solid ${(viewingItem as Powerup).accentColor}` })
            }} />
            
            <div style={styles.detailsInfo}>
              <h2 style={styles.detailsTitle}>{viewingItem.name}</h2>
              <p style={styles.detailsPrice}>
                {viewingItem.price === 0 ? 'FREE' : `$${viewingItem.price} (${(viewingItem.price / solPrice).toFixed(4)} SOL)`}
              </p>
              
              {isCharacter ? (
                <div style={styles.detailsDescription}>
                  <p><strong>Character Class</strong></p>
                  {(viewingItem as Character).powerups.length > 0 ? (
                    <p>Starts with: {(viewingItem as Character).powerups.map(p => allPowerups[p]?.name).join(', ')}</p>
                  ) : (
                    <p>A standard challenger with no innate abilities.</p>
                  )}
                </div>
              ) : (
                <div style={styles.detailsDescription}>
                  <p><strong>{(viewingItem as Powerup).description}</strong></p>
                  <p>Duration: {(viewingItem as Powerup).duration > 0 ? `${(viewingItem as Powerup).duration}s` : 'Instant'}</p>
                </div>
              )}

              {userData && (
                (() => {
                  const owned = isCharacter 
                    ? userData.purchasedCharacters.includes(viewingItem.id)
                    : userData.purchasedPowerups.includes(viewingItem.id);
                  
                  if (isCharacter) {
                    if (owned) {
                      return selectedCharacter?.id === viewingItem.id ? (
                        <button style={{ ...styles.detailsButton, ...styles.selectedButton }} disabled>EQUIPPED</button>
                      ) : (
                        <button style={styles.detailsButton} onClick={async () => {
                          if (!publicKey) return;
                          await fetch(`${API_BASE}/api/user/${publicKey.toString()}/character?character_id=${viewingItem.id}`, { method: 'POST' });
                          await fetchUserData();
                          setViewingItem(null);
                        }}>EQUIP</button>
                      );
                    }
                  } else {
                    if (owned) return <button style={{ ...styles.detailsButton, ...styles.selectedButton }} disabled>OWNED</button>;
                  }

                  return (
                    <button 
                      style={styles.detailsButton}
                      onClick={() => {
                        if (!viewingItem.price && viewingItem.price !== 0) return;
                        purchaseItem(viewingItem.id, viewingItemType!, viewingItem.price);
                        setViewingItem(null);
                      }}
                      disabled={viewingItem.price === 0 && !owned}
                    >
                      {viewingItem.price === 0 ? 'CLAIM' : 'BUY NOW'}
                    </button>
                  );
                })()
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderStore = () => (
    <div style={styles.storeScreen}>
      <button style={styles.backButton} onClick={() => setScreen('home')}>← BACK</button>
      
      <div style={styles.glassCard}>
        <h2 style={styles.sectionTitle}>CHARACTERS</h2>
        <div style={styles.storeGrid2Col}>
          {Object.values(allCharacters).map(char => {
            const owned = userData?.purchasedCharacters.includes(char.id);
            const selected = selectedCharacter?.id === char.id;
            
            return (
              <div key={char.id} style={styles.storeItem}>
                <div style={{
                  ...styles.characterPreview,
                  backgroundImage: `url(${assets.characters[char.id]})`,
                  border: selected ? '3px solid #00f0ff' : '2px solid rgba(255,255,255,0.2)'
                }} />
                <h3 style={styles.itemName}>{char.name}</h3>
                
                <div style={styles.storeActions}>
                  <button 
                    style={styles.viewDetailsButton}
                    onClick={() => {
                      setViewingItem(char);
                      setViewingItemType('character');
                    }}
                  >
                    VIEW DETAILS
                  </button>
                  
                  {owned ? (
                    selected ? (
                      <button style={{ ...styles.storeButton, ...styles.selectedButton }}>EQUIPPED</button>
                    ) : (
                      <button style={styles.storeButton} onClick={async () => {
                        if (!publicKey) return;
                        await fetch(`${API_BASE}/api/user/${publicKey.toString()}/character?character_id=${char.id}`, { method: 'POST' });
                        await fetchUserData();
                      }}>
                        EQUIP
                      </button>
                    )
                  ) : (
                    <button 
                      style={styles.storeButton}
                      onClick={() => !char.isFree && purchaseItem(char.id, 'character', char.price)}
                      disabled={char.isFree}
                    >
                      {char.isFree ? 'OWNED' : 'BUY'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ ...styles.glassCard, marginTop: '20px' }}>
        <h2 style={styles.sectionTitle}>POWERUPS</h2>
        <div style={styles.storeGrid2Col}>
          {Object.values(allPowerups).map(pow => {
            const owned = userData?.purchasedPowerups.includes(pow.id);
            
            return (
              <div key={pow.id} style={styles.storeItem}>
                <div style={{
                  ...styles.powerupPreview,
                  backgroundImage: `url(${assets.powerups[pow.id]})`,
                  borderColor: pow.accentColor
                }} />
                <h3 style={styles.itemName}>{pow.name}</h3>
                
                <div style={styles.storeActions}>
                  <button 
                    style={styles.viewDetailsButton}
                    onClick={() => {
                      setViewingItem(pow);
                      setViewingItemType('powerup');
                    }}
                  >
                    VIEW DETAILS
                  </button>

                  {owned ? (
                    <button style={{ ...styles.storeButton, ...styles.selectedButton }}>OWNED</button>
                  ) : (
                    <button 
                      style={styles.storeButton}
                      onClick={() => purchaseItem(pow.id, 'powerup', pow.price)}
                    >
                      BUY
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  const renderCredits = () => (
    <div style={styles.creditsScreen}>
      <button style={styles.backButton} onClick={() => setScreen('home')}>← BACK</button>
      <div style={styles.glassCard}>
        <h2 style={styles.sectionTitle}>CREDITS</h2>
        <div style={styles.creditsContent}>
          <p><strong>Author:</strong> Skipp (David Nzube)</p>
          <p><strong>Design Artist:</strong> Demi</p>
          <div style={styles.openSourceSection}>
            <h3>Open Source</h3>
            <p>
              The code for this project is available on <a href="https://github.com/DavidNzube101/deflect.fun" target="_blank" rel="noopener noreferrer" style={{color: '#00f0ff'}}>GitHub</a>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  const truncateAddress = (addr: string) => {
    return addr.slice(0, 4) + '...' + addr.slice(-4);
  };

  const renderLeaderboard = () => (
    <div style={styles.leaderboardScreen}>
      <button style={styles.backButton} onClick={() => setScreen('home')}>← BACK</button>

      <div style={styles.glassCard}>
        <h2 style={styles.sectionTitle}>LEADERBOARD</h2>

        <div style={styles.leaderboardList}>
          {leaderboardLoading ? (
            <div style={styles.waitingContainer}>
              <div style={styles.spinner}></div>
              <p>Loading...</p>
            </div>
          ) : leaderboard.length === 0 ? (
            <p style={styles.emptyText}>No users yet</p>
          ) : (
            leaderboard.map((entry, i) => (
              <div key={i} style={{
                ...styles.leaderboardEntry,
                ...(entry.wallet === publicKey?.toString() ? styles.currentUserEntry : {})
              }}>
                <div style={styles.entryTop}>
                  <span style={styles.rank}>#{entry.rank}</span>
                  <span style={styles.wallet}>
                    {entry.wallet === publicKey?.toString() ? 'YOU' : truncateAddress(entry.wallet)}
                  </span>
                </div>
                <div style={styles.entryBottom}>
                  <span style={styles.leaderScore}>{entry.score}</span>
                  <div style={styles.powerupIcons}>
                    {entry.purchasedPowerups?.map((id: string) => (
                      <img
                        key={id}
                        src={assets.powerups[id]}
                        style={styles.powerupIcon}
                        alt={id}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );

  const renderPvp = () => {
    if (!pvpState) {
      return (
        <div style={styles.pvpScreen}>
          <div style={styles.glassCard}>
            <h2 style={styles.sectionTitle}>PVP MATCH</h2>
            <div style={styles.waitingContainer}>
              <p>Connecting...</p>
              <div style={styles.spinner}></div>
            </div>
          </div>
        </div>
      );
    }

    if (pvpState.type === 'game_start' || pvpState.status === 'waiting') {
      return (
        <div style={styles.pvpScreen}>
          <div style={styles.glassCard}>
            <h2 style={styles.sectionTitle}>PVP MATCH</h2>
            <div style={styles.waitingContainer}>
              <p>Waiting for an opponent...</p>
              <div style={styles.spinner}></div>
              <button style={{...styles.homeButton, ...styles.secondaryButton, marginTop: 20}} onClick={() => setScreen('home')}>
                CANCEL
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (pvpState.type === 'game_end' || pvpState.status === 'gameover') {
      return (
        <div style={styles.overlay}>
          <div style={styles.glassCard}>
            <h2 style={styles.gameOverTitle}>{pvpState.winner === publicKey!.toString() ? 'YOU WIN!' : 'YOU LOSE'}</h2>
            <p style={{textAlign: 'center', color: 'white'}}>Your Score: {pvpState.player1Score}</p>
            <p style={{textAlign: 'center', color: 'white'}}>Opponent Score: {pvpState.player2Score}</p>
            <button style={styles.homeButton} onClick={() => setScreen('home')}>
              BACK TO HOME
            </button>
          </div>
        </div>
      );
    }
    
    return renderGame();
  };

  const renderAirdropModal = () => (
    <div style={styles.overlay} onClick={() => setIsAirdropModalOpen(false)}>
      <div style={{...styles.glassCard, maxWidth: '600px'}} onClick={e => e.stopPropagation()}>
        <h2 style={styles.sectionTitle}>SEASON 1 AIRDROP</h2>
        <p style={{color: 'white', textAlign: 'center'}}>
          Airdrops will be distributed to all active players at the end of the season. The top 15 players on the leaderboard will receive a larger share!
        </p>
        <p style={{color: 'white', textAlign: 'center', marginTop: '10px'}}>
          Snapshots are taken on the <strong>25th of every month at 15:00 UTC</strong>.
        </p>
        <p style={{color: 'white', textAlign: 'center', marginTop: '20px', fontWeight: 'bold'}}>
          Keep deflecting and climb the leaderboard!
        </p>
        <button style={{...styles.homeButton, marginTop: '20px'}} onClick={() => setIsAirdropModalOpen(false)}>
          CLOSE
        </button>
      </div>
    </div>
  );

  const renderNotification = () => {
    if (!notification) return null;
    
    const colors = {
      success: '#00ff00',
      error: '#ff006e',
      info: '#00f0ff'
    };
    
    return (
      <div style={{
        ...styles.notification,
        backgroundColor: colors[notification.type],
        animation: 'slideUp 0.3s ease-out'
      }}>
        {notification.message}
      </div>
    );
  };

  return (
    <div style={styles.container}>
      {screen === 'loading' && renderLoading()}
      {screen === 'home' && renderHome()}
      {screen === 'game' && renderGame()}
      {screen === 'store' && renderStore()}
      {screen === 'leaderboard' && renderLeaderboard()}
      {screen === 'credits' && renderCredits()}
      {screen === 'pvp' && renderPvp()}
      {renderItemDetails()}
      {isAirdropModalOpen && renderAirdropModal()}
      {renderNotification()}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100vw',
    height: '100vh',
    backgroundColor: '#0a0e27',
    overflow: 'auto',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    position: 'relative'
  },
  loadingScreen: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '20px'
  },
  loadingLogo: {
    width: '300px',
    height: 'auto',
    maxWidth: '80vw',
    margin: 0
  },
  loadingBar: {
    width: '300px',
    height: '10px',
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden'
  },
  loadingProgress: {
    height: '100%',
    backgroundColor: '#00f0ff',
    transition: 'width 0.3s'
  },
  loadingText: {
    color: 'white',
    fontSize: '18px'
  },
  homeScreen: {
    width: '100%',
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px'
  },
  glassCard: {
    background: 'rgba(255, 255, 255, 0.05)',
    backdropFilter: 'blur(10px)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    padding: '30px',
    maxWidth: '500px',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '15px'
  },
  homeTitle: {
    fontSize: '48px',
    color: '#00f0ff',
    margin: 0,
    textAlign: 'center',
    textShadow: '0 0 20px #00f0ff',
    animation: 'jitter 0.1s infinite'
  },
  homeSubtitle: {
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    margin: 0,
    marginBottom: '15px'
  },
  walletContainer: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '5px'
  },
  buttonContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    width: '100%'
  },
  buttonRow: {
    display: 'flex',
    gap: '10px',
    width: '100%'
  },
  homeButton: {
    padding: '15px 20px',
    fontSize: '16px',
    fontWeight: 'bold',
    backgroundColor: '#00f0ff',
    color: '#0a0e27',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.2s',
    textTransform: 'uppercase',
    flex: 1,
  },
  secondaryButton: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    color: 'white'
  },
  connectPrompt: {
    textAlign: 'center',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '14px'
  },
  statsCard: {
    background: 'rgba(0,0,0,0.3)',
    padding: '15px',
    display: 'flex',
    justifyContent: 'space-around',
    color: 'white',
    fontSize: '14px',
    marginTop: '5px'
  },
  statValue: {
    color: '#00f0ff',
    fontWeight: 'bold'
  },
  countdownSection: {
    marginTop: '20px',
    paddingTop: '20px',
    borderTop: '1px solid rgba(255, 255, 255, 0.1)',
    textAlign: 'center',
    color: 'white',
  },
  countdownTitle: {
    fontSize: '16px',
    color: '#00f0ff',
    marginBottom: '10px'
  },
  countdownTimer: {
    fontSize: '22px',
    fontWeight: 'bold',
    marginBottom: '15px'
  },
  learnMoreButton: {
    padding: '8px 16px',
    backgroundColor: 'transparent',
    color: '#00f0ff',
    border: '1px solid #00f0ff',
    cursor: 'pointer',
    fontSize: '14px'
  },
  gameContainer: {
    width: '100%',
    height: '100%',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  gameArea: {
    width: '90vmin',
    height: '90vmin',
    maxWidth: '600px',
    maxHeight: '600px',
    position: 'relative',
    border: '2px solid rgba(0, 240, 255, 0.3)',
    backgroundColor: 'rgba(0, 0, 0, 0.3)'
  },
  player: {
    position: 'absolute',
    width: '40px',
    height: '40px',
    backgroundColor: '#00f0ff',
    borderRadius: '50%',
    transform: 'translate(-50%, -50%)',
    zIndex: 10,
    transition: 'all 0.3s'
  },
  threat: {
    position: 'absolute',
    width: '30px',
    height: '30px',
    backgroundColor: '#ff006e',
    borderRadius: '50%',
    boxShadow: '0 0 20px #ff006e',
    zIndex: 5
  },
  arrow: {
    position: 'absolute',
    fontSize: '24px',
    color: 'rgba(255, 255, 255, 0.3)',
    pointerEvents: 'none',
    userSelect: 'none'
  },
  perfectFlash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 215, 0, 0.3)',
    pointerEvents: 'none',
    animation: 'fadeOut 0.2s'
  },
  powerupActive: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    fontSize: '24px',
    color: 'white',
    textShadow: '0 0 10px #00f0ff',
    fontWeight: 'bold',
    pointerEvents: 'none',
    animation: 'pulse 1s infinite'
  },
  realityWarpOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(255, 255, 0, 0.1)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '20px',
    color: 'yellow',
    fontSize: '18px',
    fontWeight: 'bold'
  },
  exitWarpButton: {
    padding: '10px 20px',
    backgroundColor: 'yellow',
    color: 'black',
    border: 'none',
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  hud: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    padding: '20px',
    pointerEvents: 'none',
    zIndex: 100
  },
  score: {
    position: 'absolute',
    top: '20px',
    left: '20px',
    color: 'white'
  },
  highScore: {
    position: 'absolute',
    top: '20px',
    right: '20px',
    color: 'white',
    textAlign: 'right'
  },
  scoreLabel: {
    fontSize: '12px',
    opacity: 0.7,
    marginBottom: '4px'
  },
  scoreValue: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: '#00f0ff'
  },
  combo: {
    position: 'absolute',
    top: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    color: '#ffd700',
    fontSize: '20px',
    fontWeight: 'bold',
    textShadow: '0 0 10px #ffd700'
  },
  powerupTimer: {
    position: 'absolute',
    top: '60px',
    left: '20px',
    color: 'white',
    fontSize: '14px',
    background: 'rgba(0,0,0,0.5)',
    padding: '5px 10px'
  },
  powerupContainer: {
    position: 'absolute',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: '10px',
    zIndex: 100
  },
  powerupButton: {
    width: '60px',
    height: '60px',
    border: '2px solid',
    cursor: 'pointer',
    background: 'rgba(0,0,0,0.5)',
    backdropFilter: 'blur(5px)',
    position: 'relative',
    transition: 'all 0.2s'
  },
  powerupUses: {
    position: 'absolute',
    top: '2px',
    right: '2px',
    background: 'red',
    color: 'white',
    fontSize: '12px',
    fontWeight: 'bold',
    padding: '2px 6px'
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 200
  },
  gameOverTitle: {
    fontSize: '36px',
    margin: 0,
    color: '#ff006e',
    textAlign: 'center'
  },
  finalScore: {
    fontSize: '64px',
    fontWeight: 'bold',
    color: '#00f0ff',
    textShadow: '0 0 30px #00f0ff',
    textAlign: 'center'
  },
  newHighScore: {
    fontSize: '18px',
    color: '#ffd700',
    textShadow: '0 0 10px #ffd700',
    textAlign: 'center'
  },
  storeScreen: {
    width: '100%',
    height: '100%',
    overflow: 'auto',
    padding: '20px'
  },
  backButton: {
    padding: '10px 20px',
    backgroundColor: 'rgba(255,255,255,0.1)',
    color: 'white',
    border: '1px solid rgba(255,255,255,0.2)',
    cursor: 'pointer',
    marginBottom: '20px',
    fontSize: '16px'
  },
  sectionTitle: {
    fontSize: '32px',
    color: '#00f0ff',
    textAlign: 'center',
    margin: 0
  },
  storeGrid2Col: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '15px',
    marginTop: '20px'
  },
  storeItem: {
    background: 'rgba(0,0,0,0.3)',
    padding: '15px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  characterPreview: {
    width: '100%',
    height: '100px',
    backgroundSize: 'cover',
    backgroundPosition: 'center'
  },
  powerupPreview: {
    width: '100%',
    height: '100px',
    backgroundSize: 'contain',
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'center',
    border: '2px solid'
  },
  itemName: {
    fontSize: '16px',
    color: 'white',
    margin: 0,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  storeActions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  storeButton: {
    padding: '8px',
    backgroundColor: '#00f0ff',
    color: '#0a0e27',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 'bold',
    fontSize: '12px',
    textTransform: 'uppercase'
  },
  viewDetailsButton: {
    padding: '8px',
    backgroundColor: 'transparent',
    color: '#00f0ff',
    border: '1px solid #00f0ff',
    cursor: 'pointer',
    fontSize: '12px'
  },
  selectedButton: {
    backgroundColor: '#00ff00'
  },
  detailsOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.7)',
    zIndex: 500,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center'
  },
  detailsDrawer: {
    width: '100%',
    maxWidth: '600px',
    background: '#1a1f3c',
    borderTopLeftRadius: '20px',
    borderTopRightRadius: '20px',
    borderTop: '2px solid #00f0ff',
    padding: '20px',
    paddingBottom: '40px',
    position: 'relative',
    animation: 'slideUp 0.3s ease-out'
  },
  closeDetailsButton: {
    position: 'absolute',
    top: '10px',
    right: '20px',
    background: 'none',
    border: 'none',
    color: 'white',
    fontSize: '32px',
    cursor: 'pointer'
  },
  detailsContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    alignItems: 'center'
  },
  detailsImage: {
    width: '150px',
    height: '150px',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    borderRadius: '10px'
  },
  detailsInfo: {
    width: '100%',
    textAlign: 'center',
    color: 'white'
  },
  detailsTitle: {
    fontSize: '28px',
    color: '#00f0ff',
    margin: '0 0 10px 0'
  },
  detailsPrice: {
    fontSize: '18px',
    color: '#ffd700',
    marginBottom: '20px'
  },
  detailsDescription: {
    background: 'rgba(0,0,0,0.3)',
    padding: '15px',
    borderRadius: '8px',
    marginBottom: '20px',
    textAlign: 'left'
  },
  detailsButton: {
    width: '100%',
    padding: '15px',
    backgroundColor: '#00f0ff',
    color: '#0a0e27',
    border: 'none',
    fontSize: '18px',
    fontWeight: 'bold',
    cursor: 'pointer',
    textTransform: 'uppercase'
  },
  creditsScreen: {
    width: '100%',
    height: '100%',
    overflow: 'auto',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center'
  },
  creditsContent: {
    padding: '20px',
    textAlign: 'center',
    color: 'white'
  },
  openSourceSection: {
    marginTop: '30px',
    borderTop: '1px solid rgba(255,255,255,0.2)',
    paddingTop: '20px'
  },
  leaderboardScreen: {
    width: '100%',
    height: '100%',
    overflow: 'auto',
    padding: '20px'
  },
  periodButtons: {
    display: 'flex',
    gap: '10px',
    justifyContent: 'center',
    marginTop: '20px'
  },
  periodButton: {
    padding: '10px 20px',
    backgroundColor: 'rgba(255,255,255,0.1)',
    color: 'white',
    border: '1px solid rgba(255,255,255,0.2)',
    cursor: 'pointer'
  },
  periodButtonActive: {
    backgroundColor: '#00f0ff',
    color: '#0a0e27'
  },
  leaderboardList: {
    marginTop: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  leaderboardEntry: {
    background: 'rgba(0,0,0,0.3)',
    padding: '15px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    color: 'white'
  },
  entryTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%'
  },
  entryBottom: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap'
  },
  currentUserEntry: {
    background: 'rgba(0, 240, 255, 0.2)',
    border: '1px solid #00f0ff'
  },
  entryActions: {
    display: 'flex',
    gap: '5px'
  },
  actionButton: {
    background: 'none',
    border: 'none',
    color: 'white',
    cursor: 'pointer',
    fontSize: '14px',
    padding: '2px'
  },
  powerupIcons: {
    display: 'flex',
    gap: '2px',
    marginLeft: '10px'
  },
  powerupIcon: {
    width: '16px',
    height: '16px'
  },
  rank: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#ffd700',
    minWidth: '50px'
  },
  wallet: {
    flex: 1,
    fontSize: '14px'
  },
  leaderScore: {
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#00f0ff'
  },
  emptyText: {
    textAlign: 'center',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '14px'
  },
  notification: {
    position: 'fixed',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '15px 30px',
    color: 'black',
    fontWeight: 'bold',
    zIndex: 1000,
    textAlign: 'center'
  },
  pvpScreen: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px'
  },
  waitingContainer: {
    textAlign: 'center',
    color: 'white',
    fontSize: '18px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '20px'
  },
  spinner: {
    border: '4px solid rgba(255, 255, 255, 0.3)',
    borderTop: '4px solid #00f0ff',
    borderRadius: '50%',
    width: '40px',
    height: '40px',
    animation: 'spin 1s linear infinite'
  },
};

const DeflectApp: React.FC = () => {
  const network = WalletAdapterNetwork.Devnet;
  const endpoint = useMemo(() => clusterApiUrl(network), [network]);
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <DeflectGame />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};

export default DeflectApp;