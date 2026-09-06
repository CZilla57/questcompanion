import Foundation
import Speech
import AVFoundation

/// Live speech-to-text for the quick-add sheet. Streams partial transcriptions
/// into `transcript`; the sheet mirrors that into its text field, which already
/// feeds the `/tasks/parse` NL parser. Voice only supplies the transcript — no
/// server change is involved.
///
/// Concurrency note: the audio tap block and the `SFSpeechRecognitionTask`
/// callback both run OFF the main actor. They never touch this object's
/// `@MainActor` stored properties directly — the tap appends to a locally
/// captured request, and the recognition callback hops to `@MainActor` via a
/// `Task { @MainActor in ... }` before mutating any published state.
@MainActor
final class SpeechRecognizer: ObservableObject {
    @Published var transcript = ""
    @Published private(set) var isRecording = false
    @Published var error: String?

    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private let recognizer = SFSpeechRecognizer(locale: Locale.current)

    /// Requests both speech-recognition and microphone authorization. Returns
    /// true only when both are granted.
    func requestAuthorization() async -> Bool {
        let speechGranted = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status == .authorized)
            }
        }
        guard speechGranted else { return false }

        // iOS 17 microphone permission API (replaces the deprecated
        // AVAudioSession.requestRecordPermission).
        let micGranted = await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
        return micGranted
    }

    func start() async {
        guard !isRecording else { return }
        error = nil
        transcript = ""

        guard await requestAuthorization() else {
            error = "Microphone or speech access is off — enable it in Settings."
            return
        }

        guard let recognizer, recognizer.isAvailable else {
            error = "Speech recognition isn't available right now."
            return
        }

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            self.error = "Couldn't start the microphone."
            stop()
            return
        }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        self.request = request

        // Install the tap on a LOCAL capture of the request — the tap block runs
        // off the main actor and must not read this object's @MainActor state.
        // `append` is thread-safe.
        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            request.append(buffer)
        }

        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            // Callback runs off the main actor; hop back before touching state.
            Task { @MainActor in
                guard let self else { return }
                if let result {
                    self.transcript = result.bestTranscription.formattedString
                    if result.isFinal { self.stop() }
                }
                if error != nil { self.stop() }
            }
        }

        do {
            audioEngine.prepare()
            try audioEngine.start()
            isRecording = true
        } catch {
            self.error = "Couldn't start the microphone."
            stop()
        }
    }

    /// Tears down the engine, tap, request, and task. Idempotent — safe to call
    /// repeatedly — and always leaves `isRecording == false`.
    func stop() {
        if audioEngine.isRunning {
            audioEngine.stop()
        }
        audioEngine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        isRecording = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
