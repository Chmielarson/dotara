#!/bin/bash

# Kolory dla lepszej czytelności
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== Wysyłanie zmian do GitHub ===${NC}"

# Przejdź do folderu projektu
cd ~/agar

# Sprawdź status
echo -e "\n${YELLOW}Status zmian:${NC}"
git status

# Zapytaj o potwierdzenie
echo -e "\n${YELLOW}Czy chcesz dodać wszystkie zmiany? (y/n)${NC}"
read -r response

if [[ "$response" == "y" || "$response" == "Y" ]]; then
    # Dodaj wszystkie zmiany
    git add .
    
    # Poproś o opis commita
    echo -e "\n${YELLOW}Podaj opis zmian (commit message):${NC}"
    read -r commit_message
    
    # Jeśli pusty opis, użyj domyślnego
    if [ -z "$commit_message" ]; then
        commit_message="Update from server $(date '+%Y-%m-%d %H:%M:%S')"
    fi
    
    # Wykonaj commit
    echo -e "\n${GREEN}Tworzenie commita...${NC}"
    git commit -m "$commit_message"
    
    # Push do GitHub
    echo -e "\n${GREEN}Wysyłanie do GitHub...${NC}"
    git push origin main
    
    if [ $? -eq 0 ]; then
        echo -e "\n${GREEN}✓ Zmiany zostały wysłane do GitHub!${NC}"
    else
        echo -e "\n${RED}✗ Błąd podczas wysyłania zmian${NC}"
        exit 1
    fi
else
    echo -e "\n${YELLOW}Anulowano wysyłanie zmian${NC}"
    exit 0
fi

echo -e "\n${GREEN}=== Gotowe! ===${NC}"