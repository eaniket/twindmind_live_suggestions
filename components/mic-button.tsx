type MicButtonProps = {
  isRecording: boolean;
  onClick: () => void;
  disabled: boolean;
};

export function MicButton({ isRecording, onClick, disabled }: MicButtonProps) {
  return (
    <button
      className={`mic-button${isRecording ? " is-recording" : ""}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      ●
    </button>
  );
}
