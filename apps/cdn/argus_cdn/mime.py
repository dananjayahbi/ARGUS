"""MIME allow-list and content sniffing for uploaded assets.

The CDN deliberately accepts only the seven media types named in the
architecture plan. Detection uses magic bytes so a client cannot smuggle an
executable or HTML document behind an image content type.
"""

from __future__ import annotations

IMAGE_MIME_TYPES = frozenset({"image/png", "image/jpeg", "image/webp"})
AUDIO_MIME_TYPES = frozenset({"audio/webm", "audio/mp4", "audio/wav", "audio/ogg"})
ALLOWED_MIME_TYPES = IMAGE_MIME_TYPES | AUDIO_MIME_TYPES

EXTENSION_BY_MIME: dict[str, str] = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "audio/webm": ".webm",
    "audio/mp4": ".m4a",
    "audio/wav": ".wav",
    "audio/ogg": ".ogg",
}

ALLOWED_EXTENSIONS_BY_MIME: dict[str, frozenset[str]] = {
    "image/png": frozenset({".png"}),
    "image/jpeg": frozenset({".jpg", ".jpeg"}),
    "image/webp": frozenset({".webp"}),
    "audio/webm": frozenset({".webm"}),
    "audio/mp4": frozenset({".m4a", ".mp4"}),
    "audio/wav": frozenset({".wav"}),
    "audio/ogg": frozenset({".ogg", ".oga"}),
}

MIME_BY_EXTENSION: dict[str, str] = {
    extension: mime_type
    for mime_type, extensions in ALLOWED_EXTENSIONS_BY_MIME.items()
    for extension in extensions
}

# MP4 brands that can carry an audio-only track produced by MediaRecorder or a
# standard encoder. The CDN allow-list has no video types, so an MP4 with one of
# these brands is classified as audio/mp4.
_AUDIO_MP4_BRANDS = frozenset(
    {b"M4A ", b"M4B ", b"F4A ", b"mp41", b"mp42", b"isom", b"iso2", b"dash", b"avc1"}
)

_SNIFF_LENGTH = 64


def normalise_content_type(value: str | None) -> str | None:
    """Lower-case a Content-Type value and drop any parameters."""
    if not value:
        return None
    return value.split(";", 1)[0].strip().lower() or None


def sniff_mime(head: bytes) -> str | None:
    """Return the allow-listed MIME type implied by the leading bytes, if any."""
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"

    if len(head) >= 12 and head[:4] == b"RIFF":
        if head[8:12] == b"WEBP":
            return "image/webp"
        if head[8:12] == b"WAVE":
            return "audio/wav"

    if head.startswith(b"OggS"):
        return "audio/ogg"

    # EBML container. The allow-list only has audio/webm, so treat it as WebM.
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return "audio/webm"

    if len(head) >= 12 and head[4:8] == b"ftyp" and head[8:12] in _AUDIO_MP4_BRANDS:
        return "audio/mp4"

    return None


def sniff_length() -> int:
    """Number of leading bytes required by :func:`sniff_mime`."""
    return _SNIFF_LENGTH
