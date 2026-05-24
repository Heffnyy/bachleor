'use client';

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { uploadAudio, type Transcript } from '@/lib/api';

type UploadFormProps = {
  token: string;
  onUploaded: (transcript: Transcript) => void | Promise<void>;
};

const ACCEPTED_AUDIO = '.mp3,.wav,.m4a,.ogg,.webm,.mp4,.mpeg';
const LANGUAGE_OPTIONS = [
  { value: '', label: 'Auto detect' },
  { value: 'ar', label: 'Arabic' },
  { value: 'en', label: 'English' },
] as const;

function createRecordingFile(blob: Blob) {
  const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
  return new File([blob], `recording-${Date.now()}.${extension}`, {
    type: blob.type || 'audio/webm',
  });
}

export function UploadForm({ token, onUploaded }: UploadFormProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<'' | 'ar' | 'en'>('');
  const [recordedAudioUrl, setRecordedAudioUrl] = useState('');
  const [recordingTime, setRecordingTime] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
      }

      if (recordedAudioUrl) {
        URL.revokeObjectURL(recordedAudioUrl);
      }

      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [recordedAudioUrl]);

  function resetRecordingTimer() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecordingTime(0);
  }

  function stopActiveStream() {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }

  function formatDuration(totalSeconds: number) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser does not support microphone recording.');
      return;
    }

    try {
      setError('');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        const file = createRecordingFile(blob);

        if (recordedAudioUrl) {
          URL.revokeObjectURL(recordedAudioUrl);
        }

        setSelectedFile(file);
        setRecordedAudioUrl(URL.createObjectURL(blob));
        setIsRecording(false);
        resetRecordingTimer();
        stopActiveStream();
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setSelectedFile(null);

      if (recordedAudioUrl) {
        URL.revokeObjectURL(recordedAudioUrl);
        setRecordedAudioUrl('');
      }

      timerRef.current = window.setInterval(() => {
        setRecordingTime((current) => current + 1);
      }, 1000);
    } catch {
      setError('Microphone access was blocked. Please allow access and try again.');
      stopActiveStream();
      resetRecordingTimer();
      setIsRecording(false);
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    if (!file) {
      return;
    }

    setError('');
    setSelectedFile(file);

    if (recordedAudioUrl) {
      URL.revokeObjectURL(recordedAudioUrl);
      setRecordedAudioUrl('');
    }
  }

  function clearSelectedAudio() {
    setSelectedFile(null);
    setError('');

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    if (recordedAudioUrl) {
      URL.revokeObjectURL(recordedAudioUrl);
      setRecordedAudioUrl('');
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedFile) {
      setError('Please upload an audio file or record one first.');
      return;
    }

    try {
      setIsUploading(true);
      setError('');
      const result = await uploadAudio(selectedFile, token, selectedLanguage);
      await onUploaded(result);
      clearSelectedAudio();
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : 'Upload failed.';
      setError(message);
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="uploadCard">
      <div>
        <p className="eyebrow">Fast Arabic + English Transcription</p>
        <h2>Upload a voice note or record directly from the browser.</h2>
        <p className="muted">
          The backend stores the transcript while the AI model runs in a separate service for cleaner scaling.
        </p>
      </div>

      <div className="recordPanel">
        <div className="recordPanelHeader">
          <strong>Live recording</strong>
          <span className={`recordBadge${isRecording ? ' is-live' : ''}`}>
            {isRecording ? `Recording ${formatDuration(recordingTime)}` : 'Ready'}
          </span>
        </div>

        <div className="recordActions">
          <button
            className="secondaryButton"
            type="button"
            onClick={startRecording}
            disabled={isRecording || isUploading}
          >
            Start recording
          </button>
          <button
            className="ghostButton"
            type="button"
            onClick={stopRecording}
            disabled={!isRecording || isUploading}
          >
            Stop recording
          </button>
        </div>

        {recordedAudioUrl ? (
          <audio controls className="audioPreview" src={recordedAudioUrl}>
            Your browser does not support audio playback.
          </audio>
        ) : null}
      </div>

      <label className="filePicker">
        <span>Select audio</span>
        <input
          ref={fileInputRef}
          name="audio"
          type="file"
          accept={ACCEPTED_AUDIO}
          onChange={handleFileChange}
        />
      </label>

      <label className="fieldGroup">
        <span>Transcription language</span>
        <select
          className="textInput"
          value={selectedLanguage}
          onChange={(event) => setSelectedLanguage(event.target.value as '' | 'ar' | 'en')}
          disabled={isUploading || isRecording}
        >
          {LANGUAGE_OPTIONS.map((option) => (
            <option key={option.value || 'auto'} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {selectedFile ? (
        <div className="selectedAudioCard">
          <div>
            <strong>{selectedFile.name}</strong>
            <p className="metaText">
              Ready to upload
              {selectedLanguage ? ` • ${selectedLanguage === 'ar' ? 'Arabic' : 'English'}` : ' • Auto detect'}
            </p>
          </div>
          <button className="textButton" type="button" onClick={clearSelectedAudio}>
            Clear
          </button>
        </div>
      ) : null}

      <button className="primaryButton" type="submit" disabled={isUploading || isRecording}>
        {isUploading ? 'Transcribing...' : 'Start transcription'}
      </button>

      {error ? <p className="errorText">{error}</p> : null}
    </form>
  );
}
