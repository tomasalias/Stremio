# Use official PHP image with Composer
FROM php:8.2-cli

# Install Composer
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# Set working directory
WORKDIR /app

# Copy project files
COPY . .

# Install PHP dependencies (if vendor/ is missing, Composer will rebuild it)
RUN composer install --no-dev --optimize-autoloader || true

# Expose the Render port
EXPOSE 10000

# Start the PHP built-in web server
CMD ["php", "-S", "0.0.0.0:10000", "addon.php"]
