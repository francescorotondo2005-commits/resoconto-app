import json
import sys

# Forza UTF-8 per l'output se eseguito in console
if sys.stdout.encoding != 'utf-8':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

def extract_comments():
    log_path = r'C:\Users\pierr\.gemini\antigravity\brain\a720771c-0f74-4a73-a55f-bcfd177a4a4d\.system_generated\logs\transcript.jsonl'
    
    comments = []
    with open(log_path, 'r', encoding='utf-8') as f:
        for line in f:
            try:
                data = json.loads(line)
                if data.get('source') == 'USER_EXPLICIT' or data.get('type') == 'USER_INPUT':
                    content = data.get('content', '')
                    comments.append(content)
            except Exception as e:
                pass
                
    # Scriviamo l'output su un file di testo in UTF-8
    out_path = r'c:\Users\pierr\OneDrive\Desktop\app\resoconto-app\scratch\comments_output.txt'
    with open(out_path, 'w', encoding='utf-8') as out_f:
        out_f.write(f"Trovati {len(comments)} messaggi totali dell'utente:\n")
        for idx, c in enumerate(comments, 1):
            out_f.write(f"\n--- MESSAGGIO {idx} ---\n")
            out_f.write(c)
            out_f.write("\n")
            
    print(f"Salvati {len(comments)} messaggi in scratch/comments_output.txt")

if __name__ == '__main__':
    extract_comments()
