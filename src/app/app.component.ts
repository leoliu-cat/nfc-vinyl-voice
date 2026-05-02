import { Component, OnInit, OnDestroy, ChangeDetectorRef, AfterViewInit, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
const API_BASE_URL = "https://api.sharememori.com"; // TODO: 放上您部署好的 Cloudflare Worker 網址

const isMockMode = () => !API_BASE_URL;
const LOCAL_STORAGE_PREFIX = "aws_mock_";

const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      resolve(reader.result as string);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

const base64ToBlob = async (base64: string): Promise<Blob> => {
  const response = await fetch(base64);
  const blob = await response.blob();
  if (blob.type === 'application/octet-stream' || !blob.type) {
    const isMp4 = base64.includes('audio/mp4');
    return new Blob([blob], { type: isMp4 ? 'audio/mp4' : 'audio/webm' });
  }
  return blob;
};

const getAudioUrl = async (id: string): Promise<string | null> => {
  if (!isMockMode()) {
    try {
      // 假設 Cloudflare Worker 會幫我們從 S3 獲取預簽名網址或直接回傳音檔
      const res = await fetch(`${API_BASE_URL}/api/audio/${id}`);
      if (res.ok) {
        const data = await res.json();
        return data.url;
      }
    } catch (e) {
      console.error("Failed to fetch from Cloudflare API", e);
    }
  }

  const localData = localStorage.getItem(LOCAL_STORAGE_PREFIX + id);
  if (localData) {
    try {
      const blob = await base64ToBlob(localData);
      return URL.createObjectURL(blob);
    } catch (e) {
      console.error("Local retrieval failed", e);
    }
  }
  return null;
};

const uploadToS3 = async (id: string, blob: Blob): Promise<string> => {
  if (!isMockMode()) {
    try {
      // 透過 Cloudflare Worker 上傳至 S3
      const mimeType = blob.type || 'audio/mp4';
      const reqBlob = new Blob([blob], { type: mimeType });
      const res = await fetch(`${API_BASE_URL}/api/audio/${id}`, {
        method: 'PUT',
        body: reqBlob,
        headers: {
          'Content-Type': mimeType
        }
      });
      if (res.ok) {
        return await getAudioUrl(id) as string;
      }
    } catch (error: any) {
      console.error("Cloudflare upload failed, fallback to local", error);
    }
  }

  // Fallback / Mock
  try {
    const base64 = await blobToBase64(blob);
    localStorage.setItem(LOCAL_STORAGE_PREFIX + id, base64);
    return URL.createObjectURL(blob);
  } catch (e) {
    throw new Error("Mock storage failed");
  }
};

const deleteFromS3 = async (id: string): Promise<void> => {
  localStorage.removeItem(LOCAL_STORAGE_PREFIX + id);

  if (!isMockMode()) {
    try {
      await fetch(`${API_BASE_URL}/api/audio/${id}`, { method: 'DELETE' });
    } catch (error: any) {
      console.error("Cloudflare delete failed", error);
    }
  }
};

const saveMetadataToS3 = async (id: string, trackId: string) => {
  if (isMockMode()) return;
  try {
    await fetch(`${API_BASE_URL}/api/metadata/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spotifyTrackId: trackId })
    });
  } catch (error) {
    console.error("Failed to save metadata", error);
  }
};

const loadMetadataFromS3 = async (id: string): Promise<string | null> => {
  if (isMockMode()) return null;
  try {
    const res = await fetch(`${API_BASE_URL}/api/metadata/${id}`);
    if (res.ok) {
      const data = await res.json();
      return data.spotifyTrackId || null;
    }
  } catch (error: any) {
    console.error("Failed to load metadata", error);
  }
  return null;
};

// 方案：HMAC 加密簽名防呆機制
// 此密鑰用來對 ID 進行簽名。在正式環境中，這個 Secret 絕對不可以外洩。
const NFC_SECRET = 'ministylecards-nfc-secret-key';

// Helper: 將依賴十六進位的簽名轉成 byte array 給 SubtleCrypto 驗證
function hexToBytes(hex: string): Uint8Array | null {
  if (!hex || hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// 驗證 HMAC-SHA256 簽名
async function verifyHmacSignature(id: string, signatureHex: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(NFC_SECRET);
    const cryptoKey = await crypto.subtle.importKey(
      'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBytes = hexToBytes(signatureHex);
    if (!sigBytes) return false;
    
    return await crypto.subtle.verify('HMAC', cryptoKey, sigBytes, encoder.encode(id));
  } catch (e) {
    return false;
  }
}

// 開發者工具：在瀏覽器 Console 中你可以執行 window.generateNfcLink("你的任意ID") 
// 來快速產生帶有合法簽名的測試網址
(window as any).generateNfcLink = async (id: string) => {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(NFC_SECRET);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(id));
  const signatureHex = Array.from(new Uint8Array(signatureBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  const url = `${window.location.origin}${window.location.pathname}?id=${id}&sig=${signatureHex}`;
  console.log(`合法寫入網址:\n${url}`);
  return url;
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html'
})
export class AppComponent implements OnInit, OnDestroy, AfterViewInit {
  appState: 'IDLE' | 'RECORDING' | 'PLAYING_AUDIO' | 'PLAYING_SPOTIFY' = 'IDLE';
  hasRecording = false;
  recordingTime = 0;
  audioUrl: string | null = null;
  isConfirmingDelete = false;
  isSyncing = false;
  syncMessage = 'Syncing...';
  spotifyTrackId = '0tgVpDi06FyKpA1z0VMD4v';
  isEditingSpotify = false;
  spotifyInput = '';
  cloudId = 'demo-default';
  isSpotifyPlaying = false;
  spotifyController: any = null;
  
  isInvalidNfc = false;

  toastMessage = '';
  isToastVisible = false;
  toastTimeout: any;

  mediaRecorder: MediaRecorder | null = null;
  audioChunks: Blob[] = [];
  audioElement = new Audio();
  recordingInterval: any;

  constructor(private sanitizer: DomSanitizer, private cdr: ChangeDetectorRef, private ngZone: NgZone) {
    this.audioElement.onended = () => {
      this.ngZone.run(() => {
        this.appState = 'IDLE';
        this.cdr.detectChanges();
      });
    };
  }

  safeSpotifyUrl!: SafeResourceUrl;

  updateSpotifyUrl() {
    this.safeSpotifyUrl = this.sanitizer.bypassSecurityTrustResourceUrl(`https://open.spotify.com/embed/track/${this.spotifyTrackId}?utm_source=generator`);
    if (this.spotifyController) {
      this.spotifyController.loadUri(`spotify:track:${this.spotifyTrackId}`);
    }
  }

  loadSpotifyApi() {
    if ((window as any).SpotifyIframeApiReady) {
      this.initSpotifyController();
      return;
    }

    (window as any).onSpotifyIframeApiReady = (IFrameAPI: any) => {
      (window as any).SpotifyIframeApiReady = true;
      (window as any).SpotifyIFrameAPI = IFrameAPI;
      this.initSpotifyController();
    };

    const script = document.createElement('script');
    script.src = 'https://open.spotify.com/embed/iframe-api/v1';
    script.async = true;
    document.body.appendChild(script);
  }

  initSpotifyController() {
    const IFrameAPI = (window as any).SpotifyIFrameAPI;
    if (!IFrameAPI) return;

    const element = document.getElementById('spotify-iframe');
    if (!element) return;

    const options = {
      width: '100%',
      height: '152',
      uri: `spotify:track:${this.spotifyTrackId}`
    };

    const callback = (EmbedController: any) => {
      this.spotifyController = EmbedController;

      EmbedController.addListener('playback_update', (e: any) => {
        this.ngZone.run(() => {
          this.isSpotifyPlaying = !e.data.isPaused;
          if (this.isSpotifyPlaying && this.appState === 'PLAYING_AUDIO') {
            this.audioElement.pause();
            this.appState = 'IDLE';
          }
          this.cdr.detectChanges();
        });
      });
    };

    IFrameAPI.createController(element, options, callback);
  }

  formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  triggerToast(message: string) {
    this.toastMessage = message;
    this.isToastVisible = true;
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.isToastVisible = false;
      this.cdr.detectChanges();
    }, 3000);
  }

  async ngOnInit() {
    const urlParams = new URLSearchParams(window.location.search);
    let id = urlParams.get('id');
    const sig = urlParams.get('sig'); // 獲取 signature
    
    // 如果沒有附帶 id，或者是舊的 demo-default (為了讓你在沒有參數時可以測試，這裡保持開放 demo-default)
    if (!id || id === 'demo-default') {
       id = 'demo-default';
       this.cloudId = id;
    } else {
       // HMAC 防呆：檢查 URL 上的 ID 與 sig 是否成功匹配
       if (!sig) {
          this.isInvalidNfc = true;
          return; // 沒有帶簽名直接拒絕
       }
       
       const isValid = await verifyHmacSignature(id, sig);
       if (!isValid) {
          this.isInvalidNfc = true;
          return; // 簽名不正確直接拒絕
       }
       
       this.cloudId = id;
    }
    

    this.isSyncing = true;
    
    const cloudTrackId = await loadMetadataFromS3(this.cloudId);
    if (cloudTrackId) {
      this.spotifyTrackId = cloudTrackId;
    } else {
      const savedTrack = localStorage.getItem('spotify_track_' + this.cloudId);
      if (savedTrack) {
        this.spotifyTrackId = savedTrack;
      }
    }
    this.updateSpotifyUrl();

    const url = await getAudioUrl(this.cloudId);
    if (url) {
      this.audioUrl = url;
      this.hasRecording = true;
      this.audioElement.src = url;
      this.audioElement.load();
    }
    
    this.isSyncing = false;
    this.cdr.detectChanges();
  }

  ngAfterViewInit() {
    this.loadSpotifyApi();
  }

  ngOnDestroy() {
    if (this.recordingInterval) clearInterval(this.recordingInterval);
    this.audioElement.pause();
  }

  async startRecording() {
    try {
      this.syncMessage = 'Waking up microphone...';
      this.isSyncing = true;
      this.cdr.detectChanges();

      // Wake up the audio hardware via playback path early
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          ctx.resume();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          gain.gain.value = 0; // Silent
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(0);
          osc.stop(ctx.currentTime + 0.1);
        }
      } catch (e) {}

      const stream = await navigator.mediaDevices.getUserMedia({ audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      } });
      
      // Much shorter warmup to prevent long UX delay, hardware is kept awake by AudioCtx
      await new Promise(resolve => setTimeout(resolve, 300));

      this.isSyncing = false;
      this.syncMessage = 'Syncing...'; // reset

      let options: MediaRecorderOptions = {};
      if (MediaRecorder.isTypeSupported('audio/mp4')) {
        options.mimeType = 'audio/mp4';
      } else if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        options.mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        options.mimeType = 'audio/webm';
      }

      this.mediaRecorder = new MediaRecorder(stream, options.mimeType ? options : undefined);
      this.audioChunks = [];

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.audioChunks.push(e.data);
      };

      this.mediaRecorder.onstop = () => {
        this.ngZone.run(async () => {
          const actualMimeType = this.mediaRecorder!.mimeType || (this.audioChunks[0] && this.audioChunks[0].type) || 'audio/webm';
          const audioBlob = new Blob(this.audioChunks, { type: actualMimeType });
          this.isSyncing = true;
          this.cdr.detectChanges();
          
          try {
            const url = await uploadToS3(this.cloudId, audioBlob);
            this.audioUrl = url;
            this.hasRecording = true;
            this.audioElement.src = url;
            this.audioElement.load(); // Force the browser to load the new source
            this.triggerToast("Recording saved!");
          } catch (error) {
            console.error("Upload failed", error);
            this.triggerToast("Failed to save recording");
          } finally {
            this.isSyncing = false;
            this.appState = 'IDLE';
            this.cdr.detectChanges();
          }
        });
      };

      this.mediaRecorder.start();
      this.appState = 'RECORDING';
      this.recordingTime = 0;
      this.recordingInterval = setInterval(() => {
        this.recordingTime++;
        this.cdr.detectChanges();
      }, 1000);
    } catch (err) {
      console.error("Microphone access denied", err);
      this.triggerToast("Microphone access denied");
    }
  }

  stopRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
      this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
      clearInterval(this.recordingInterval);
    }
  }

  toggleAudioPlayback() {
    if (this.appState === 'PLAYING_AUDIO') {
      this.audioElement.pause();
      this.appState = 'IDLE';
    } else {
      if (!this.audioElement.src) {
        this.triggerToast("No audio source found");
        return;
      }
      const playPromise = this.audioElement.play();
      if (playPromise !== undefined) {
        playPromise.catch(e => {
          console.error("Audio play failed:", e);
          this.appState = 'IDLE';
          
          if (e.name === 'NotSupportedError') {
             this.triggerToast("Audio format not supported on this device. (Please try re-recording)");
          } else {
             this.triggerToast("Unable to play recording.");
          }
          this.cdr.detectChanges();
        });
      }
      this.appState = 'PLAYING_AUDIO';
      if (this.spotifyController && this.isSpotifyPlaying) {
        this.spotifyController.pause();
      }
    }
  }

  async deleteRecording() {
    this.isConfirmingDelete = false;
    this.isSyncing = true;
    this.cdr.detectChanges();
    
    await deleteFromS3(this.cloudId);
    
    this.audioUrl = null;
    this.hasRecording = false;
    this.appState = 'IDLE';
    
    this.audioElement.pause();
    this.audioElement.src = '';
    
    this.isSyncing = false;
    this.triggerToast("Recording deleted");
    this.cdr.detectChanges();
  }

  onPaste(event: ClipboardEvent) {
    const pastedText = event.clipboardData?.getData('text');
    if (pastedText) {
      this.spotifyInput = pastedText;
      event.preventDefault();
    }
  }

  saveSpotifyTrack() {
    let newId = "";
    if (this.spotifyInput.includes("track/")) {
      const parts = this.spotifyInput.split("track/");
      newId = parts[1].split("?")[0].split("/")[0];
    } else {
      newId = this.spotifyInput.trim();
    }
    
    if (newId) {
      this.spotifyTrackId = newId;
      this.updateSpotifyUrl();
      localStorage.setItem('spotify_track_' + this.cloudId, newId);
      saveMetadataToS3(this.cloudId, newId);
      this.isEditingSpotify = false;
      this.spotifyInput = "";
      this.triggerToast("Spotify track updated!");
    } else {
      this.triggerToast("Invalid Spotify link");
    }
  }
}
