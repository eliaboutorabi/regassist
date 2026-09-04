/**
 * The realtime voice session.
 *
 * Flow: our server mints a short-lived client secret with the caller's own key
 * and the harness tool schemas baked in, then the browser opens a WebRTC
 * connection straight to OpenAI with that secret. Audio rides the media track;
 * events and transcripts ride the data channel.
 *
 * Function calls arrive here but execute on our server (`/api/tools`) — the
 * government APIs send no CORS headers — and the result goes back to the model
 * as a `function_call_output`. That is what makes a regulation card appear on
 * screen a beat before Verity starts describing it.
 */

import type { ToolCallView, ToolResultView } from '$lib/harness';
import type { StoredDocument } from '$lib/plugins';
import type { CharacterId } from '$lib/voices';

export type VoiceStatus =
	| 'idle'
	| 'connecting'
	| 'listening'
	| 'thinking'
	| 'speaking'
	| 'error';

export interface VoiceHandlers {
	onStatus(status: VoiceStatus, detail?: string): void;
	onUserTranscript(text: string): void;
	onAssistantDelta(delta: string): void;
	onAssistantDone(): void;
	onToolCall(callId: string, name: string, view?: ToolCallView): void;
	onToolResult(
		callId: string,
		isError: boolean,
		view?: ToolResultView,
		durationMs?: number
	): void;
	onError(message: string): void;
	/** Called every animation frame with the output envelope, 0–1. */
	onAudioLevel(level: number, audible: boolean): void;
}

export interface VoiceStartOptions {
	apiKey: string;
	character: CharacterId;
	documents: StoredDocument[];
	/** Speak an opening line without waiting for the user. */
	greet?: boolean;
}

interface PendingCall {
	callId: string;
	name: string;
	args: string;
}

const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

export class VoiceSession {
	#pc: RTCPeerConnection | null = null;
	#channel: RTCDataChannel | null = null;
	#stream: MediaStream | null = null;
	#audio: HTMLAudioElement | null = null;
	#context: AudioContext | null = null;
	#analyser: AnalyserNode | null = null;
	#buffer: Uint8Array<ArrayBuffer> | null = null;
	#frame = 0;
	#envelope = 0;
	#lastAudibleAt = -Infinity;
	#pending = new Map<string, PendingCall>();
	/** Tool calls from the current response that have not returned yet. */
	#outstanding = 0;
	/** Whether the current response has finished emitting its output items. */
	#responseClosed = true;
	/** Tool calls this response made, so we only follow up when it made some. */
	#calledThisResponse = 0;
	#documents: StoredDocument[] = [];
	#status: VoiceStatus = 'idle';
	#muted = false;

	constructor(private readonly handlers: VoiceHandlers) {}

	get status(): VoiceStatus {
		return this.#status;
	}

	get active(): boolean {
		return this.#pc !== null;
	}

	get muted(): boolean {
		return this.#muted;
	}

	/** Keep the connection but stop sending the user's audio. */
	setMuted(muted: boolean): void {
		this.#muted = muted;
		for (const track of this.#stream?.getAudioTracks() ?? []) track.enabled = !muted;
	}

	/** Documents can change mid-session; tools read the latest set. */
	setDocuments(documents: StoredDocument[]): void {
		this.#documents = documents;
	}

	async start(options: VoiceStartOptions): Promise<void> {
		if (this.#pc) return;
		this.#documents = options.documents;
		this.#setStatus('connecting');

		try {
			const secret = await this.#mintSecret(options);
			this.#stream = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
			});

			const pc = new RTCPeerConnection();
			this.#pc = pc;

			pc.addEventListener('track', (event) => this.#attachRemoteAudio(event.streams[0]));
			pc.addEventListener('connectionstatechange', () => {
				if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
					this.#setStatus('error', 'The voice connection dropped.');
					this.handlers.onError('The voice connection dropped. Tap to reconnect.');
					this.stop();
				}
			});

			for (const track of this.#stream.getAudioTracks()) pc.addTrack(track, this.#stream);
			if (this.#muted) this.setMuted(true);

			const channel = pc.createDataChannel('oai-events');
			this.#channel = channel;
			channel.addEventListener('open', () => {
				this.#setStatus('listening');
				if (options.greet) this.#requestGreeting();
			});
			channel.addEventListener('message', (message) => {
				try {
					this.#handleEvent(JSON.parse(message.data as string));
				} catch {
					// A malformed frame is not worth ending the session over.
				}
			});

			const offer = await pc.createOffer();
			await pc.setLocalDescription(offer);

			const answer = await fetch(REALTIME_CALLS_URL, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${secret}`,
					'Content-Type': 'application/sdp'
				},
				body: offer.sdp ?? ''
			});

			const sdp = await answer.text();
			if (!answer.ok) {
				throw new Error(
					`OpenAI refused the voice connection (${answer.status}). ${sdp.slice(0, 200)}`
				);
			}
			await pc.setRemoteDescription({ type: 'answer', sdp });
		} catch (cause) {
			const message = describeVoiceError(cause);
			this.#setStatus('error', message);
			this.handlers.onError(message);
			this.stop();
			throw cause;
		}
	}

	stop(): void {
		cancelAnimationFrame(this.#frame);
		this.#frame = 0;

		if (this.#channel?.readyState === 'open') this.#channel.close();
		this.#pc?.close();
		for (const track of this.#stream?.getTracks() ?? []) track.stop();
		if (this.#audio) this.#audio.srcObject = null;
		void this.#context?.close().catch(() => {});

		this.#channel = null;
		this.#pc = null;
		this.#stream = null;
		this.#context = null;
		this.#analyser = null;
		this.#buffer = null;
		this.#envelope = 0;
		this.#lastAudibleAt = -Infinity;
		this.#pending.clear();
		this.#outstanding = 0;
		this.#calledThisResponse = 0;
		this.#responseClosed = true;
		this.handlers.onAudioLevel(0, false);
		if (this.#status !== 'error') this.#setStatus('idle');
	}

	/** Inject a typed message into a live voice session. */
	say(text: string): boolean {
		if (this.#channel?.readyState !== 'open') return false;
		this.#send({
			type: 'conversation.item.create',
			item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
		});
		this.#send({ type: 'response.create' });
		return true;
	}

	// ------------------------------------------------------------- internals

	async #mintSecret(options: VoiceStartOptions): Promise<string> {
		const response = await fetch('/api/realtime', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'x-openai-key': options.apiKey },
			body: JSON.stringify({ character: options.character })
		});
		const payload = (await response.json().catch(() => null)) as
			| { clientSecret?: string; message?: string }
			| null;

		if (!response.ok || !payload?.clientSecret) {
			throw new Error(payload?.message ?? `Could not start a voice session (${response.status}).`);
		}
		return payload.clientSecret;
	}

	#requestGreeting(): void {
		this.#send({ type: 'response.create' });
	}

	#send(payload: unknown): void {
		if (this.#channel?.readyState === 'open') this.#channel.send(JSON.stringify(payload));
	}

	#setStatus(status: VoiceStatus, detail?: string): void {
		this.#status = status;
		this.handlers.onStatus(status, detail);
	}

	#attachRemoteAudio(stream: MediaStream): void {
		this.#audio ??= Object.assign(document.createElement('audio'), {
			autoplay: true,
			// iOS refuses to play inline audio without this.
			playsInline: true
		});
		this.#audio.srcObject = stream;
		void this.#audio.play().catch(() => {});

		this.#context ??= new AudioContext();
		void this.#context.resume().catch(() => {});

		const analyser = this.#context.createAnalyser();
		analyser.fftSize = 512;
		analyser.smoothingTimeConstant = 0.82;
		this.#context.createMediaStreamSource(stream).connect(analyser);
		this.#analyser = analyser;
		this.#buffer = new Uint8Array(new ArrayBuffer(analyser.fftSize));

		this.#startMeter();
	}

	/**
	 * Drive the robot's mouth from the waveform we are actually hearing, not
	 * from whether a response object exists — the tail of an utterance still
	 * has to move the jaw and feed the receipt.
	 */
	#startMeter(): void {
		let previous = performance.now();

		const tick = (now: number) => {
			this.#frame = requestAnimationFrame(tick);
			const delta = Math.min((now - previous) / 1000, 0.05);
			previous = now;

			const analyser = this.#analyser;
			const buffer = this.#buffer;
			if (!analyser || !buffer) return;

			analyser.getByteTimeDomainData(buffer);
			let sum = 0;
			for (const sample of buffer) {
				const centred = (sample - 128) / 128;
				sum += centred * centred;
			}
			const rms = Math.sqrt(sum / buffer.length);
			const normalised = clamp((rms - 0.018) / 0.14, 0, 1);
			const target = normalised < 0.018 ? 0 : smoothstep(normalised);

			// Rise fast, fall slow: a mouth that snaps shut reads as a glitch.
			const damping = target > this.#envelope ? 20 : 10;
			this.#envelope += (target - this.#envelope) * (1 - Math.exp(-damping * delta));
			if (this.#envelope < 0.004) this.#envelope = 0;

			if (rms > 0.0015) this.#lastAudibleAt = now / 1000;
			const audible = now / 1000 - this.#lastAudibleAt < 0.22;
			this.handlers.onAudioLevel(this.#envelope, audible);
		};

		cancelAnimationFrame(this.#frame);
		this.#frame = requestAnimationFrame(tick);
	}

	#handleEvent(event: Record<string, unknown>): void {
		const type = event.type as string;

		switch (type) {
			case 'session.created':
			case 'session.updated':
				if (this.#status === 'connecting') this.#setStatus('listening');
				break;

			case 'input_audio_buffer.speech_started':
				this.#setStatus('listening');
				break;

			case 'input_audio_buffer.speech_stopped':
			case 'input_audio_buffer.committed':
				this.#setStatus('thinking');
				break;

			case 'conversation.item.input_audio_transcription.completed': {
				const transcript = (event.transcript as string)?.trim();
				if (transcript) this.handlers.onUserTranscript(transcript);
				break;
			}

			case 'response.created':
				this.#outstanding = 0;
				this.#calledThisResponse = 0;
				this.#responseClosed = false;
				this.#setStatus('speaking');
				break;

			case 'response.output_audio_transcript.delta': {
				const delta = event.delta as string;
				if (delta) {
					this.#setStatus('speaking');
					this.handlers.onAssistantDelta(delta);
				}
				break;
			}

			case 'response.output_item.added': {
				const item = event.item as { id?: string; type?: string; call_id?: string; name?: string };
				if (item?.type === 'function_call' && item.call_id && item.name) {
					this.#pending.set(String(item.id ?? item.call_id), {
						callId: item.call_id,
						name: item.name,
						args: ''
					});
				}
				break;
			}

			case 'response.function_call_arguments.delta': {
				const entry = this.#pending.get(String(event.item_id));
				if (entry) entry.args += (event.delta as string) ?? '';
				break;
			}

			case 'response.function_call_arguments.done': {
				const key = String(event.item_id);
				const entry = this.#pending.get(key);
				if (!entry) break;
				this.#pending.delete(key);
				this.#outstanding += 1;
				this.#calledThisResponse += 1;
				void this.#runTool(entry, (event.arguments as string) ?? entry.args);
				break;
			}

			case 'response.done': {
				this.handlers.onAssistantDone();
				// Only now do we know how many calls this response made, which is
				// what makes it safe to decide whether a follow-up is owed.
				this.#responseClosed = true;
				this.#continueIfSettled();
				break;
			}

			case 'output_audio_buffer.stopped':
				// The tail of the audio, not the end of the response object, is
				// when a listener actually stops hearing Verity.
				if (this.#responseClosed && this.#outstanding === 0 && this.#status === 'speaking') {
					this.#setStatus('listening');
				}
				break;

			case 'error': {
				const message =
					(event.error as { message?: string })?.message ?? 'The voice session reported an error.';
				this.#setStatus('error', message);
				this.handlers.onError(message);
				break;
			}

			default:
				break;
		}
	}

	async #runTool(call: PendingCall, rawArguments: string): Promise<void> {
		let parsed: Record<string, unknown> = {};
		try {
			parsed = rawArguments.trim() ? (JSON.parse(rawArguments) as Record<string, unknown>) : {};
		} catch {
			parsed = {};
		}

		this.handlers.onToolCall(call.callId, call.name, undefined);

		let output = 'The tool call could not be completed.';
		let isError = true;
		let view: ToolResultView | undefined;
		let durationMs: number | undefined;

		try {
			const response = await fetch('/api/tools', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					callId: call.callId,
					name: call.name,
					arguments: parsed,
					documents: this.#documents
				})
			});
			const payload = (await response.json()) as {
				output?: string;
				isError?: boolean;
				view?: ToolResultView | null;
				durationMs?: number;
				message?: string;
			};

			if (response.ok) {
				output = payload.output ?? output;
				isError = payload.isError ?? false;
				view = payload.view ?? undefined;
				durationMs = payload.durationMs;
			} else {
				output = payload.message ?? `The tool server returned ${response.status}.`;
			}
		} catch (cause) {
			output = `The tool could not be reached: ${describeVoiceError(cause)}`;
		}

		this.handlers.onToolResult(call.callId, isError, view, durationMs);

		this.#send({
			type: 'conversation.item.create',
			item: { type: 'function_call_output', call_id: call.callId, output }
		});

		this.#outstanding = Math.max(0, this.#outstanding - 1);
		this.#continueIfSettled();
	}

	/**
	 * Ask for the spoken answer once, when the response has finished emitting
	 * its calls *and* every one of them has come back.
	 *
	 * Waiting on both conditions matters: a fast (or cached) tool can return
	 * before the model has finished streaming its second call, and following up
	 * on an outstanding count alone would then request two responses for one
	 * turn — which the user hears as Verity answering twice.
	 */
	#continueIfSettled(): void {
		if (!this.#responseClosed || this.#outstanding > 0) return;

		if (this.#calledThisResponse > 0) {
			this.#calledThisResponse = 0;
			this.#send({ type: 'response.create' });
			return;
		}
		if (this.#status !== 'error') this.#setStatus('listening');
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function smoothstep(value: number): number {
	return value * value * (3 - 2 * value);
}

export function describeVoiceError(cause: unknown): string {
	if (cause instanceof DOMException) {
		if (cause.name === 'NotAllowedError') {
			return 'Microphone access was blocked. Allow it in your browser, then try again.';
		}
		if (cause.name === 'NotFoundError') return 'No microphone was found on this device.';
	}
	return cause instanceof Error ? cause.message : 'The voice session could not start.';
}
