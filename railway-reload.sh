#!/bin/bash

# Script para recargar clientes en Railway
# Uso: ./railway-reload.sh [URL_DE_RAILWAY]

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# URL de Railway (puede ser pasada como argumento o configurada aquí)
RAILWAY_URL=${1:-"https://tu-app.railway.app"}

echo -e "${BLUE}🚂 Recargando clientes en Railway...${NC}"
echo -e "${YELLOW}📍 URL: $RAILWAY_URL${NC}"

# Verificar que curl esté disponible
if ! command -v curl &> /dev/null; then
    echo -e "${RED}❌ Error: curl no está instalado${NC}"
    exit 1
fi

# Verificar estado del servidor
echo -e "\n${BLUE}🔍 Verificando estado del servidor...${NC}"
HEALTH_RESPONSE=$(curl -s "$RAILWAY_URL/health")

if [[ $? -eq 0 ]]; then
    echo -e "${GREEN}✅ Servidor funcionando${NC}"
else
    echo -e "${RED}❌ Error: No se puede conectar al servidor${NC}"
    echo -e "${YELLOW}💡 Verifica que:${NC}"
    echo -e "   - La URL de Railway sea correcta"
    echo -e "   - El servidor esté funcionando"
    echo -e "   - No haya problemas de red"
    exit 1
fi

# Recargar clientes
echo -e "\n${BLUE}🔄 Recargando clientes...${NC}"
RELOAD_RESPONSE=$(curl -s -X POST "$RAILWAY_URL/clients/reload")

if [[ $? -eq 0 ]]; then
    echo -e "${GREEN}✅ Recarga exitosa${NC}"
    
    # Extraer información del cliente Miriam Carmona
    MIRIAM_ADMIN=$(echo "$RELOAD_RESPONSE" | grep -o '"adminPhone":"[^"]*"' | head -1 | cut -d'"' -f4)
    
    if [[ -n "$MIRIAM_ADMIN" ]]; then
        echo -e "\n${BLUE}📋 Cliente Miriam Carmona:${NC}"
        echo -e "   Admin Phone: $MIRIAM_ADMIN"
        
        EXPECTED_PHONE="5216183045331@c.us"
        if [[ "$MIRIAM_ADMIN" == "$EXPECTED_PHONE" ]]; then
            echo -e "${GREEN}🎉 ¡Railway actualizado correctamente!${NC}"
        else
            echo -e "${RED}❌ Railway aún no está actualizado${NC}"
            echo -e "${YELLOW}   Esperado: $EXPECTED_PHONE${NC}"
            echo -e "${YELLOW}   Actual: $MIRIAM_ADMIN${NC}"
        fi
    else
        echo -e "${YELLOW}⚠️ No se pudo extraer información del cliente Miriam Carmona${NC}"
    fi
    
    # Mostrar respuesta completa si se solicita
    if [[ "$2" == "--verbose" ]]; then
        echo -e "\n${BLUE}📄 Respuesta completa:${NC}"
        echo "$RELOAD_RESPONSE" | python -m json.tool 2>/dev/null || echo "$RELOAD_RESPONSE"
    fi
    
else
    echo -e "${RED}❌ Error al recargar clientes${NC}"
    echo -e "${YELLOW}💡 Posibles causas:${NC}"
    echo -e "   - El servidor no está respondiendo"
    echo -e "   - Problemas de autenticación"
    echo -e "   - Error en el endpoint"
fi

echo -e "\n${BLUE}✨ Proceso completado${NC}"


