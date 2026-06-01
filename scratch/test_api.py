import urllib.request
import json
import ssl

apiKey = "811db2ed64e4fd123eb1055a5e52e54d"
url = 'https://v3.football.api-sports.com/fixtures?league=137&season=2024'

req = urllib.request.Request(
    url, 
    headers={
        'x-apisports-key': apiKey,
        'User-Agent': 'Mozilla/5.0'
    }
)

try:
    # Bypass SSL verification if needed, or use default context
    context = ssl._create_unverified_context()
    with urllib.request.urlopen(req, context=context) as response:
        html = response.read().decode('utf-8')
        data = json.loads(html)
        print("Status Code:", response.getcode())
        print("Results:", data.get('results'))
        if data.get('response') and len(data.get('response')) > 0:
            print("Sample fixture keys:", data['response'][0]['fixture'].keys())
            print("Sample fixture:", data['response'][0]['fixture'])
except Exception as e:
    print("Error:", e)
