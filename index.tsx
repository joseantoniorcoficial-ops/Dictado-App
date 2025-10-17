/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/* tslint:disable */

import {GoogleGenAI} from '@google/genai';
import {marked} from 'marked';

declare const html2pdf: any;

const MODEL_NAME = 'gemini-2.5-flash';
const STORAGE_KEY = 'voice-notes-app-data';

interface Note {
  id: string;
  title: string;
  rawTranscription: string;
  polishedNote: string;
  timestamp: number;
}

class VoiceNotesApp {
  private genAI: GoogleGenAI;
  private mediaRecorder: MediaRecorder | null = null;
  private recordButton: HTMLButtonElement;
  private recordingStatus: HTMLDivElement;
  private rawTranscription: HTMLDivElement;
  private polishedNote: HTMLDivElement;
  private themeToggleButton: HTMLButtonElement;
  private themeToggleIcon: HTMLElement;
  private audioChunks: Blob[] = [];
  private isRecording = false;
  private stream: MediaStream | null = null;
  private editorTitle: HTMLDivElement;

  // New UI Elements
  private sidebar: HTMLElement;
  private noteList: HTMLUListElement;
  private newNoteButton: HTMLButtonElement;
  private sidebarToggle: HTMLButtonElement;
  private saveStatus: HTMLSpanElement;
  private copyPolishedButton: HTMLButtonElement;
  private downloadMarkdownButton: HTMLButtonElement;
  private downloadPdfButton: HTMLButtonElement;
  private deleteNoteButton: HTMLButtonElement;
  private rawSpinner: HTMLDivElement;
  private polishedSpinner: HTMLDivElement;


  // Note Management
  private notes: Note[] = [];
  private currentNote: Note | null = null;
  private saveTimeout: number | null = null;

  // Live recording display
  private recordingInterface: HTMLDivElement;
  private liveRecordingTitle: HTMLDivElement;
  private liveWaveformCanvas: HTMLCanvasElement | null;
  private liveWaveformCtx: CanvasRenderingContext2D | null = null;
  private liveRecordingTimerDisplay: HTMLDivElement;
  private statusIndicatorDiv: HTMLDivElement | null;
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private waveformDataArray: Uint8Array | null = null;
  private waveformDrawingId: number | null = null;
  private timerIntervalId: number | null = null;
  private recordingStartTime: number = 0;

  constructor() {
    this.genAI = new GoogleGenAI({apiKey: process.env.API_KEY!});

    // Main editor elements
    this.recordButton = document.getElementById('recordButton') as HTMLButtonElement;
    this.recordingStatus = document.getElementById('recordingStatus') as HTMLDivElement;
    this.rawTranscription = document.getElementById('rawTranscription') as HTMLDivElement;
    this.polishedNote = document.getElementById('polishedNote') as HTMLDivElement;
    this.editorTitle = document.querySelector('.editor-title') as HTMLDivElement;
    
    // Theme toggle
    this.themeToggleButton = document.getElementById('themeToggleButton') as HTMLButtonElement;
    this.themeToggleIcon = this.themeToggleButton.querySelector('i') as HTMLElement;
    
    // Sidebar and note management
    this.sidebar = document.querySelector('.sidebar') as HTMLElement;
    this.noteList = document.getElementById('noteList') as HTMLUListElement;
    this.newNoteButton = document.getElementById('newNoteButton') as HTMLButtonElement;
    this.sidebarToggle = document.getElementById('sidebarToggle') as HTMLButtonElement;

    // Note actions
    this.saveStatus = document.getElementById('saveStatus') as HTMLSpanElement;
    this.copyPolishedButton = document.getElementById('copyPolishedButton') as HTMLButtonElement;
    this.downloadMarkdownButton = document.getElementById('downloadMarkdownButton') as HTMLButtonElement;
    this.downloadPdfButton = document.getElementById('downloadPdfButton') as HTMLButtonElement;
    this.deleteNoteButton = document.getElementById('deleteNoteButton') as HTMLButtonElement;
    
    // Spinners
    this.rawSpinner = document.getElementById('rawSpinner') as HTMLDivElement;
    this.polishedSpinner = document.getElementById('polishedSpinner') as HTMLDivElement;

    // Live recording UI
    this.recordingInterface = document.querySelector('.recording-interface') as HTMLDivElement;
    this.liveRecordingTitle = document.getElementById('liveRecordingTitle') as HTMLDivElement;
    this.liveWaveformCanvas = document.getElementById('liveWaveformCanvas') as HTMLCanvasElement;
    this.liveRecordingTimerDisplay = document.getElementById('liveRecordingTimerDisplay') as HTMLDivElement;
    this.statusIndicatorDiv = this.recordingInterface.querySelector('.status-indicator') as HTMLDivElement;

    if (this.liveWaveformCanvas) {
      this.liveWaveformCtx = this.liveWaveformCanvas.getContext('2d');
    }

    this.bindEventListeners();
    this.initTheme();
    this.loadNotesFromStorage();
    this.renderNoteList();

    if (this.notes.length > 0) {
      this.loadNote(this.notes[0].id);
    } else {
      this.createNewNote();
    }

    this.recordingStatus.textContent = 'Listo para grabar';
  }

  private bindEventListeners(): void {
    this.recordButton.addEventListener('click', () => this.toggleRecording());
    this.newNoteButton.addEventListener('click', () => this.createNewNote());
    this.themeToggleButton.addEventListener('click', () => this.toggleTheme());
    this.sidebarToggle.addEventListener('click', () => this.toggleSidebar());
    this.noteList.addEventListener('click', (e) => this.handleNoteListClick(e));
    
    this.copyPolishedButton.addEventListener('click', () => this.copyPolishedNote());
    this.downloadMarkdownButton.addEventListener('click', () => this.downloadAsMarkdown());
    this.downloadPdfButton.addEventListener('click', () => this.downloadAsPdf());
    this.deleteNoteButton.addEventListener('click', () => this.deleteCurrentNote());

    this.editorTitle.addEventListener('input', () => this.scheduleAutoSave());
    this.rawTranscription.addEventListener('input', () => this.scheduleAutoSave());
    this.polishedNote.addEventListener('input', () => this.scheduleAutoSave());
    
    window.addEventListener('resize', this.handleResize.bind(this));
  }
  
  private handleNoteListClick(event: MouseEvent): void {
      const target = event.target as HTMLElement;
      const listItem = target.closest('.note-list-item');
      if (!listItem) return;

      const noteId = listItem.getAttribute('data-id');
      if (!noteId) return;

      if (target.closest('.note-item-delete')) {
          this.deleteNote(noteId);
      } else {
          this.loadNote(noteId);
      }
  }

  // Note Data Management
  private loadNotesFromStorage(): void {
    const savedNotes = localStorage.getItem(STORAGE_KEY);
    if (savedNotes) {
      this.notes = JSON.parse(savedNotes);
      this.notes.sort((a, b) => b.timestamp - a.timestamp);
    }
  }

  private saveNotesToStorage(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.notes));
  }

  private scheduleAutoSave(): void {
    if (!this.currentNote) return;
    this.saveStatus.classList.remove('fade-out');
    this.saveStatus.textContent = 'Guardando...';
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = window.setTimeout(() => {
      this.saveCurrentNote();
    }, 1500);
  }

  private saveCurrentNote(): void {
    if (!this.currentNote) return;

    this.currentNote.title = this.editorTitle.textContent?.trim() || 'Nota sin Título';
    this.currentNote.rawTranscription = this.rawTranscription.textContent?.trim() || '';
    this.currentNote.polishedNote = this.polishedNote.innerHTML; // Save HTML for rich text
    this.currentNote.timestamp = Date.now();

    this.notes.sort((a, b) => b.timestamp - a.timestamp);
    this.saveNotesToStorage();
    this.renderNoteList();

    this.saveStatus.textContent = 'Guardado';
    this.saveStatus.classList.add('fade-out');
  }

  private createNewNote(): void {
    if (this.isRecording) this.stopRecording();
    
    const newNote: Note = {
      id: `note_${Date.now()}`,
      title: 'Nota sin Título',
      rawTranscription: '',
      polishedNote: '',
      timestamp: Date.now(),
    };
    this.notes.unshift(newNote);
    this.saveNotesToStorage();
    this.loadNote(newNote.id);
    this.renderNoteList();
    this.editorTitle.focus();
    this.recordingStatus.textContent = 'Listo para grabar';
  }
  
  private loadNote(noteId: string): void {
      const noteToLoad = this.notes.find(note => note.id === noteId);
      if (!noteToLoad) return;

      this.currentNote = noteToLoad;

      this.updateEditorContent(noteToLoad);
      this.renderNoteList(); // To update active highlight
  }
  
  private updateEditorContent(note: Note): void {
    this.editorTitle.textContent = note.title;
    this.rawTranscription.textContent = note.rawTranscription;
    this.polishedNote.innerHTML = note.polishedNote;
    this.updateAllPlaceholders();
  }

  private deleteCurrentNote(): void {
      if (this.currentNote) {
          this.deleteNote(this.currentNote.id);
      }
  }
  
  private deleteNote(noteId: string): void {
      if (!confirm('¿Estás seguro de que quieres eliminar esta nota?')) return;

      this.notes = this.notes.filter(note => note.id !== noteId);
      this.saveNotesToStorage();

      if (this.currentNote && this.currentNote.id === noteId) {
          this.currentNote = null;
      }
      
      this.renderNoteList();

      if (this.notes.length > 0) {
          if (!this.currentNote) this.loadNote(this.notes[0].id);
      } else {
          this.createNewNote();
      }
  }

  // UI Rendering
  private renderNoteList(): void {
    this.noteList.innerHTML = '';
    if (this.notes.length === 0) {
      this.noteList.innerHTML = '<li class="no-notes-message">Aún no hay notas.</li>';
      return;
    }
    this.notes.forEach(note => {
      const li = document.createElement('li');
      li.className = 'note-list-item';
      if (this.currentNote && this.currentNote.id === note.id) {
        li.classList.add('active');
      }
      li.setAttribute('data-id', note.id);
      li.innerHTML = `
        <span class="note-item-title">${note.title}</span>
        <span class="note-item-date">${this.formatDate(note.timestamp)}</span>
        <button class="note-item-delete" title="Eliminar Nota"><i class="fas fa-times"></i></button>
      `;
      this.noteList.appendChild(li);
    });
  }

  private formatDate(timestamp: number): string {
      const now = new Date();
      const date = new Date(timestamp);
      const diffSeconds = Math.round((now.getTime() - date.getTime()) / 1000);
      const diffDays = Math.floor(diffSeconds / 86400);

      if (diffSeconds < 60) return 'Ahora mismo';
      if (diffSeconds < 3600) return `hace ${Math.floor(diffSeconds / 60)} min`;
      if (diffSeconds < 86400) return `hace ${Math.floor(diffSeconds / 3600)} h`;
      if (diffDays === 1) return 'Ayer';
      if (diffDays < 7) return `hace ${diffDays} días`;
      return date.toLocaleDateString('es-ES');
  }

  private handleResize(): void {
    if (this.isRecording && this.liveWaveformCanvas && this.liveWaveformCanvas.style.display === 'block') {
      requestAnimationFrame(() => this.setupCanvasDimensions());
    }
  }

  private setupCanvasDimensions(): void {
    if (!this.liveWaveformCanvas || !this.liveWaveformCtx) return;
    const canvas = this.liveWaveformCanvas;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    this.liveWaveformCtx.scale(dpr, dpr);
  }

  private initTheme(): void {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
      document.body.classList.add('light-mode');
      this.themeToggleIcon.classList.replace('fa-sun', 'fa-moon');
    } else {
      document.body.classList.remove('light-mode');
      this.themeToggleIcon.classList.replace('fa-moon', 'fa-sun');
    }
  }

  private toggleTheme(): void {
    document.body.classList.toggle('light-mode');
    if (document.body.classList.contains('light-mode')) {
      localStorage.setItem('theme', 'light');
      this.themeToggleIcon.classList.replace('fa-sun', 'fa-moon');
    } else {
      localStorage.setItem('theme', 'dark');
      this.themeToggleIcon.classList.replace('fa-moon', 'fa-sun');
    }
  }
  
  private toggleSidebar(): void {
    document.body.classList.toggle('sidebar-closed');
  }

  private async toggleRecording(): Promise<void> {
    if (!this.isRecording) {
      await this.startRecording();
    } else {
      await this.stopRecording();
    }
  }

  private setupAudioVisualizer(): void {
    if (!this.stream || this.audioContext) return;

    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 256;
    this.analyserNode.smoothingTimeConstant = 0.75;
    this.waveformDataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
    source.connect(this.analyserNode);
  }

  private drawLiveWaveform(): void {
    if (!this.analyserNode || !this.waveformDataArray || !this.liveWaveformCtx || !this.liveWaveformCanvas || !this.isRecording) {
      if (this.waveformDrawingId) cancelAnimationFrame(this.waveformDrawingId);
      this.waveformDrawingId = null;
      return;
    }
    this.waveformDrawingId = requestAnimationFrame(() => this.drawLiveWaveform());
    this.analyserNode.getByteFrequencyData(this.waveformDataArray);
    const ctx = this.liveWaveformCtx;
    const canvas = this.liveWaveformCanvas;
    const logicalWidth = canvas.clientWidth;
    const logicalHeight = canvas.clientHeight;
    ctx.clearRect(0, 0, logicalWidth, logicalHeight);
    const bufferLength = this.analyserNode.frequencyBinCount;
    const numBars = Math.floor(bufferLength * 0.5);
    if (numBars === 0) return;
    const totalBarPlusSpacingWidth = logicalWidth / numBars;
    const barWidth = Math.max(1, Math.floor(totalBarPlusSpacingWidth * 0.7));
    const barSpacing = Math.max(0, Math.floor(totalBarPlusSpacingWidth * 0.3));
    let x = 0;
    const recordingColor = getComputedStyle(document.documentElement).getPropertyValue('--color-recording').trim() || '#ff3b30';
    ctx.fillStyle = recordingColor;
    for (let i = 0; i < numBars; i++) {
      if (x >= logicalWidth) break;
      const dataIndex = Math.floor(i * (bufferLength / numBars));
      const barHeightNormalized = this.waveformDataArray[dataIndex] / 255.0;
      let barHeight = barHeightNormalized * logicalHeight;
      if (barHeight < 1 && barHeight > 0) barHeight = 1;
      barHeight = Math.round(barHeight);
      const y = Math.round((logicalHeight - barHeight) / 2);
      ctx.fillRect(Math.floor(x), y, barWidth, barHeight);
      x += barWidth + barSpacing;
    }
  }

  private updateLiveTimer(): void {
    if (!this.isRecording || !this.liveRecordingTimerDisplay) return;
    const elapsedMs = Date.now() - this.recordingStartTime;
    const totalSeconds = Math.floor(elapsedMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const hundredths = Math.floor((elapsedMs % 1000) / 10);
    this.liveRecordingTimerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
  }

  private startLiveDisplay(): void {
    this.recordingInterface.classList.add('is-live');
    this.liveRecordingTitle.style.display = 'block';
    this.liveWaveformCanvas.style.display = 'block';
    this.liveRecordingTimerDisplay.style.display = 'block';
    this.setupCanvasDimensions();
    if (this.statusIndicatorDiv) this.statusIndicatorDiv.style.display = 'none';
    const iconElement = this.recordButton.querySelector('.record-button-inner i') as HTMLElement;
    if (iconElement) iconElement.classList.replace('fa-microphone', 'fa-stop');
    this.liveRecordingTitle.textContent = this.currentNote?.title || 'Nueva Grabación';
    this.setupAudioVisualizer();
    this.drawLiveWaveform();
    this.recordingStartTime = Date.now();
    this.updateLiveTimer();
    if (this.timerIntervalId) clearInterval(this.timerIntervalId);
    this.timerIntervalId = window.setInterval(() => this.updateLiveTimer(), 50);
  }

  private stopLiveDisplay(): void {
    this.recordingInterface.classList.remove('is-live');
    this.liveRecordingTitle.style.display = 'none';
    this.liveWaveformCanvas.style.display = 'none';
    this.liveRecordingTimerDisplay.style.display = 'none';
    if (this.statusIndicatorDiv) this.statusIndicatorDiv.style.display = 'block';
    const iconElement = this.recordButton.querySelector('.record-button-inner i') as HTMLElement;
    if (iconElement) iconElement.classList.replace('fa-stop', 'fa-microphone');
    if (this.waveformDrawingId) cancelAnimationFrame(this.waveformDrawingId);
    this.waveformDrawingId = null;
    if (this.timerIntervalId) clearInterval(this.timerIntervalId);
    this.timerIntervalId = null;
    if (this.liveWaveformCtx && this.liveWaveformCanvas) this.liveWaveformCtx.clearRect(0, 0, this.liveWaveformCanvas.width, this.liveWaveformCanvas.height);
    if (this.audioContext && this.audioContext.state !== 'closed') this.audioContext.close().catch(console.warn);
    this.audioContext = null;
    this.analyserNode = null;
    this.waveformDataArray = null;
  }

  private async startRecording(): Promise<void> {
    try {
      this.audioChunks = [];
      if (this.stream) this.stream.getTracks().forEach(track => track.stop());
      if (this.audioContext && this.audioContext.state !== 'closed') await this.audioContext.close();
      this.audioContext = null;
      this.recordingStatus.textContent = 'Solicitando acceso al micrófono...';
      this.stream = await navigator.mediaDevices.getUserMedia({audio: true});
      this.mediaRecorder = new MediaRecorder(this.stream, {mimeType: 'audio/webm'});
      this.mediaRecorder.ondataavailable = event => event.data.size > 0 && this.audioChunks.push(event.data);
      this.mediaRecorder.onstop = () => {
        this.stopLiveDisplay();
        if (this.audioChunks.length > 0) {
          const audioBlob = new Blob(this.audioChunks, {type: this.mediaRecorder?.mimeType || 'audio/webm'});
          this.processAudio(audioBlob).catch(err => {
            console.error('Error al procesar audio:', err);
            this.recordingStatus.textContent = 'Error al procesar la grabación';
          });
        } else {
          this.recordingStatus.textContent = 'No se capturó audio. Por favor, intenta de nuevo.';
        }
        if (this.stream) this.stream.getTracks().forEach(track => track.stop());
        this.stream = null;
      };
      this.mediaRecorder.start();
      this.isRecording = true;
      this.recordButton.classList.add('recording');
      this.recordButton.setAttribute('title', 'Detener Grabación');
      this.startLiveDisplay();
    } catch (error) {
      console.error('Error al iniciar la grabación:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorName = error instanceof Error ? error.name : 'Unknown';
      if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') this.recordingStatus.textContent = 'Permiso de micrófono denegado.';
      else if (errorName === 'NotFoundError') this.recordingStatus.textContent = 'No se encontró ningún micrófono.';
      else this.recordingStatus.textContent = `Error: ${errorMessage}`;
      this.isRecording = false;
      if (this.stream) this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
      this.recordButton.classList.remove('recording');
      this.recordButton.setAttribute('title', 'Iniciar Grabación');
      this.stopLiveDisplay();
    }
  }

  private async stopRecording(): Promise<void> {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
      this.recordButton.classList.remove('recording');
      this.recordButton.setAttribute('title', 'Iniciar Grabación');
      this.recordingStatus.textContent = 'Procesando audio...';
    } else if (!this.isRecording) {
      this.stopLiveDisplay();
    }
  }

  private async processAudio(audioBlob: Blob): Promise<void> {
    if (audioBlob.size === 0) {
      this.recordingStatus.textContent = 'No se capturó audio.';
      return;
    }
    this.recordingStatus.textContent = 'Convirtiendo audio...';
    const reader = new FileReader();
    const readResult = new Promise<string>((resolve, reject) => {
      reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = () => reject(reader.error);
    });
    reader.readAsDataURL(audioBlob);
    const base64Audio = await readResult;
    if (!base64Audio) throw new Error('Falló la conversión de audio a base64');
    const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
    await this.getTranscription(base64Audio, mimeType);
  }

  private async getTranscription(base64Audio: string, mimeType: string): Promise<void> {
    this.showSpinner(this.rawSpinner);
    try {
      this.recordingStatus.textContent = 'Obteniendo transcripción...';
      const contents = [
        {text: 'Genera una transcripción completa y detallada de este audio.'},
        {inlineData: {mimeType, data: base64Audio}},
      ];
      const response = await this.genAI.models.generateContent({model: MODEL_NAME, contents});
      const transcriptionText = response.text;

      this.rawTranscription.textContent = transcriptionText;
      this.updatePlaceholder(this.rawTranscription);
      if (this.currentNote) this.currentNote.rawTranscription = transcriptionText;
      this.scheduleAutoSave();
      
      this.recordingStatus.textContent = 'Transcripción completa. Puliendo nota...';
      this.getPolishedNote().catch(err => {
        console.error('Error al pulir la nota:', err);
        this.recordingStatus.textContent = 'Error al pulir la nota después de la transcripción.';
      });
    } catch (error) {
      console.error('Error al obtener la transcripción:', error);
      this.recordingStatus.textContent = 'Error al obtener la transcripción. Por favor, intenta de nuevo.';
    } finally {
        this.hideSpinner(this.rawSpinner);
    }
  }

  private async getPolishedNote(): Promise<void> {
    if (!this.rawTranscription.textContent?.trim()) {
        this.recordingStatus.textContent = 'No hay transcripción para pulir';
        return;
    }
    this.showSpinner(this.polishedSpinner);
    try {
      this.recordingStatus.textContent = 'Puliendo nota...';
      const prompt = `Toma esta transcripción en bruto y crea una nota pulida y bien formateada. Elimina palabras de relleno, repeticiones y titubeos. Formatea listas y encabezados usando Markdown. Mantén el significado original.\n\nTranscripción en bruto:\n${this.rawTranscription.textContent}`;
      const response = await this.genAI.models.generateContent({model: MODEL_NAME, contents: {parts: [{text: prompt}]}});
      const polishedText = response.text;
      
      if (polishedText) {
        const htmlContent = marked.parse(polishedText);
        this.polishedNote.innerHTML = htmlContent;
        this.updatePlaceholder(this.polishedNote);
        if (this.currentNote) this.currentNote.polishedNote = htmlContent;
        
        const noteTitle = this.extractTitleFromMarkdown(polishedText);
        if (noteTitle) {
          this.editorTitle.textContent = noteTitle;
          if (this.currentNote) this.currentNote.title = noteTitle;
        }

        this.scheduleAutoSave();
        this.recordingStatus.textContent = 'Nota pulida. Listo para la siguiente grabación.';
      } else {
        this.recordingStatus.textContent = 'El pulido falló o no devolvió nada.';
      }
    } catch (error) {
      console.error('Error al pulir la nota:', error);
      this.recordingStatus.textContent = 'Error al pulir la nota. Por favor, intenta de nuevo.';
    } finally {
        this.hideSpinner(this.polishedSpinner);
    }
  }

  private extractTitleFromMarkdown(markdown: string): string | null {
      const lines = markdown.split('\n').map(l => l.trim());
      for (const line of lines) {
          if (line.startsWith('# ')) return line.substring(2).trim();
      }
      for (const line of lines) {
          if (line.length > 3 && line.length < 60 && !line.startsWith('*') && !line.startsWith('-')) return line;
      }
      return null;
  }
  
  // UI Helpers
  private updateAllPlaceholders(): void {
    [this.editorTitle, this.rawTranscription, this.polishedNote].forEach(el => this.updatePlaceholder(el));
  }
  
  private updatePlaceholder(el: HTMLElement): void {
    const placeholder = el.getAttribute('placeholder') || '';
    const content = el.id === 'polishedNote' ? el.innerHTML : el.textContent;
    if (content.trim() === '' || content.trim() === placeholder) {
      el.classList.add('placeholder-active');
      el.innerHTML = el.id === 'polishedNote' ? placeholder : '';
      if(el.id !== 'polishedNote') el.textContent = '';
    } else {
      el.classList.remove('placeholder-active');
    }
  }

  private showSpinner(spinner: HTMLElement) { spinner.classList.add('show'); }
  private hideSpinner(spinner: HTMLElement) { spinner.classList.remove('show'); }
  
  private showFeedback(message: string, element: HTMLElement) {
      const feedback = document.createElement('div');
      feedback.className = 'feedback-tooltip';
      feedback.textContent = message;
      document.body.appendChild(feedback);

      const rect = element.getBoundingClientRect();
      feedback.style.left = `${rect.left + rect.width / 2 - feedback.offsetWidth / 2}px`;
      feedback.style.top = `${rect.top - feedback.offsetHeight - 5}px`;
      
      setTimeout(() => feedback.remove(), 2000);
  }

  // Note actions
  private copyPolishedNote(): void {
      const textToCopy = this.polishedNote.innerText;
      navigator.clipboard.writeText(textToCopy).then(() => {
          this.showFeedback('¡Copiado!', this.copyPolishedButton);
      }).catch(err => console.error('Falló la copia del texto: ', err));
  }

  private downloadAsMarkdown(): void {
    if (!this.currentNote) return;
    const markdownContent = this.polishedNote.innerHTML; // Assuming it's already markdown parsed
    const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.currentNote.title.replace(/ /g, '_')}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private downloadAsPdf(): void {
    if (!this.currentNote) return;

    const noteTitle = this.currentNote.title;
    const filename = `${noteTitle.replace(/ /g, '_')}.pdf`;
    
    // Create a temporary element to render for the PDF
    const element = document.createElement('div');
    
    // Applying styles directly for a consistent PDF output
    element.style.width = '100%';
    element.innerHTML = `
      <div style="padding: 40px; font-family: 'Inter', sans-serif;">
        <h1 style="font-size: 24px; color: #000; margin-bottom: 20px;">${noteTitle}</h1>
        <div style="font-size: 16px; line-height: 1.7; color: #333;">
          ${this.polishedNote.innerHTML}
        </div>
      </div>
    `;

    const opt = {
      margin: [0.5, 0.5, 0.5, 0.5], // top, left, bottom, right in inches
      filename: filename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
    };

    html2pdf().from(element).set(opt).save();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new VoiceNotesApp();
  document.querySelectorAll<HTMLElement>('[contenteditable][placeholder]').forEach(el => {
    const placeholder = el.getAttribute('placeholder')!;
    el.addEventListener('focus', function() {
      if (this.classList.contains('placeholder-active')) {
        if (this.id === 'polishedNote') this.innerHTML = '';
        else this.textContent = '';
        this.classList.remove('placeholder-active');
      }
    });
    el.addEventListener('blur', function() {
      const content = (this.id === 'polishedNote' ? this.innerHTML : this.textContent)?.trim();
      if (content === '') {
        this.classList.add('placeholder-active');
        if (this.id === 'polishedNote') this.innerHTML = placeholder;
      }
    });
  });
});

export {};