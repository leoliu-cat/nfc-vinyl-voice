import { Component, OnInit, OnDestroy, ChangeDetectorRef, AfterViewInit, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
const API_BASE_URL = ""; // TODO: 放上您部署好的 Cloudflare Worker 網址

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
  return await response.blob();
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
      const reqBlob = new Blob([blob], { type: "audio/mp4" });
      const res = await fetch(`${API_BASE_URL}/api/audio/${id}`, {
        method: 'PUT',
        body: reqBlob,
        headers: {
          'Content-Type': 'audio/mp4'
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
  spotifyTrackId = '0tgVpDi06FyKpA1z0VMD4v';
  isEditingSpotify = false;
  spotifyInput = '';
  cloudId = 'demo-default';
  isSpotifyPlaying = false;
  spotifyController: any = null;

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
    
    // 如果網址沒有提供 id，自動產生一組 Random UUID 以利獨立寫入測試
    if (!id || id === 'demo-default') {
      id = ("crypto" in window && typeof crypto.randomUUID === "function") 
        ? crypto.randomUUID() 
        : Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      
      const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?id=' + id;
      window.history.replaceState({path: newUrl}, '', newUrl);
    }
    
    this.cloudId = id;

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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      let options: MediaRecorderOptions = {};
      if (MediaRecorder.isTypeSupported('audio/mp4')) {
        options.mimeType = 'audio/mp4';
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
          const audioBlob = new Blob(this.audioChunks, { type: this.mediaRecorder!.mimeType || 'audio/webm' });
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
      const playPromise = this.audioElement.play();
      if (playPromise !== undefined) {
        playPromise.catch(e => {
          console.error("Audio play failed:", e);
          this.triggerToast("Unable to play audio format");
          this.appState = 'IDLE';
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
    this.audioElement.removeAttribute('src');
    this.audioElement.load();
    
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
